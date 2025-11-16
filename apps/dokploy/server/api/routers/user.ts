import {
	IS_CLOUD,
	createApiKey,
	findAdmin,
	findNotificationById,
	findOrganizationById,
	findUserById,
	getUserByToken,
	removeUserById,
	sendEmailNotification,
	updateUser,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import {
	account,
	apiAssignPermissions,
	apiFindOneToken,
	apiUpdateUser,
	apikey,
	invitation,
	member,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import * as bcrypt from "bcrypt";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
	uploadProcedure,
} from "../trpc";
import { uploadProfilePictureSchema } from "@/utils/schema";

const apiCreateApiKey = z.object({
	name: z.string().min(1),
	prefix: z.string().optional(),
	expiresIn: z.number().optional(),
	metadata: z.object({
		organizationId: z.string(),
	}),
	// Rate limiting
	rateLimitEnabled: z.boolean().optional(),
	rateLimitTimeWindow: z.number().optional(),
	rateLimitMax: z.number().optional(),
	// Request limiting
	remaining: z.number().optional(),
	refillAmount: z.number().optional(),
	refillInterval: z.number().optional(),
});

export const userRouter = createTRPCRouter({
	all: adminProcedure.query(async ({ ctx }) => {
		return await db.query.member.findMany({
			where: eq(member.organizationId, ctx.session.activeOrganizationId),
			with: {
				user: true,
			},
			orderBy: [asc(member.createdAt)],
		});
	}),
	one: protectedProcedure
		.input(
			z.object({
				userId: z.string(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const memberResult = await db.query.member.findFirst({
				where: and(
					eq(member.userId, input.userId),
					eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
				),
				with: {
					user: true,
				},
			});

			return memberResult;
		}),
	get: protectedProcedure.query(async ({ ctx }) => {
		const memberResult = await db.query.member.findFirst({
			where: and(
				eq(member.userId, ctx.user.id),
				eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
			),
			with: {
				user: {
					with: {
						apiKeys: true,
					},
				},
			},
		});

		return memberResult;
	}),
	haveRootAccess: protectedProcedure.query(async ({ ctx }) => {
		if (!IS_CLOUD) {
			return false;
		}
		if (
			process.env.USER_ADMIN_ID === ctx.user.id ||
			ctx.session?.impersonatedBy === process.env.USER_ADMIN_ID
		) {
			return true;
		}
		return false;
	}),
	getBackups: adminProcedure.query(async ({ ctx }) => {
		const memberResult = await db.query.member.findFirst({
			where: and(
				eq(member.userId, ctx.user.id),
				eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
			),
			with: {
				user: {
					with: {
						backups: {
							with: {
								destination: true,
								deployments: true,
							},
						},
						apiKeys: true,
					},
				},
			},
		});

		return memberResult?.user;
	}),
	getServerMetrics: protectedProcedure.query(async ({ ctx }) => {
		const memberResult = await db.query.member.findFirst({
			where: and(
				eq(member.userId, ctx.user.id),
				eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
			),
			with: {
				user: true,
			},
		});

		return memberResult?.user;
	}),
	uploadProfilePicture: protectedProcedure
		.use(uploadProcedure)
		.input(uploadProfilePictureSchema)
		.mutation(async ({ input, ctx }) => {
			const imageFile = input.image;

			// Validate file size (2MB max)
			const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB in bytes
			if (imageFile.size > MAX_FILE_SIZE) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Image size must be less than 2MB",
				});
			}

			// Validate file type
			const allowedMimeTypes = [
				"image/jpeg",
				"image/jpg",
				"image/png",
				"image/gif",
				"image/webp",
			];
			if (!allowedMimeTypes.includes(imageFile.type)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed",
				});
			}

			try {
				// Get the current user to check for existing custom avatar
				const currentUser = await findUserById(ctx.user.id);
				const oldImagePath = currentUser?.image;

				// Determine the correct path to public directory
				// Use __dirname to get the file location, then resolve relative to it
				// __dirname in compiled code points to dist/server/api/routers
				// In source code, it points to server/api/routers
				// We need to go up to the app root (apps/dokploy)
				let publicDir: string;
				let uploadsDir: string;

				// Try multiple strategies to find the public directory
				// Strategy 1: Use __dirname (most reliable)
				const dirnamePublicDir = path.resolve(__dirname, "../../../public");
				if (fs.existsSync(dirnamePublicDir)) {
					publicDir = dirnamePublicDir;
					uploadsDir = path.join(dirnamePublicDir, "avatars/uploads");
				} else {
					// Strategy 2: Check if process.cwd() is the app directory
					const appPublicDir = path.join(process.cwd(), "public");
					if (fs.existsSync(appPublicDir)) {
						publicDir = appPublicDir;
						uploadsDir = path.join(appPublicDir, "avatars/uploads");
					} else {
						// Strategy 3: Check if process.cwd() is the monorepo root
						const monorepoPublicDir = path.join(
							process.cwd(),
							"apps/dokploy/public",
						);
						if (fs.existsSync(monorepoPublicDir)) {
							publicDir = monorepoPublicDir;
							uploadsDir = path.join(monorepoPublicDir, "avatars/uploads");
						} else {
							// Final fallback: use __dirname and create if needed
							publicDir = dirnamePublicDir;
							uploadsDir = path.join(dirnamePublicDir, "avatars/uploads");
						}
					}
				}

				console.log("Public Dir:", publicDir);
				console.log("Upload Dir:", uploadsDir);

				// Create uploads directory if it doesn't exist
				if (!fs.existsSync(uploadsDir)) {
					fs.mkdirSync(uploadsDir, { recursive: true });
				}

				// Verify directory was created
				if (!fs.existsSync(uploadsDir)) {
					throw new Error(
						`Failed to create uploads directory at: ${uploadsDir}`,
					);
				}

				// Generate unique filename
				const fileExtension = path.extname(imageFile.name) || ".jpg";
				const timestamp = Date.now();
				const randomString = Math.random().toString(36).substring(2, 15);
				const fileName = `${ctx.user.id}-${timestamp}-${randomString}${fileExtension}`;
				const filePath = path.join(uploadsDir, fileName);

				// Convert File to Buffer and write to disk
				const arrayBuffer = await imageFile.arrayBuffer();
				const buffer = Buffer.from(arrayBuffer);
				fs.writeFileSync(filePath, buffer);

				// Verify file was written
				if (!fs.existsSync(filePath)) {
					throw new Error(`Failed to write file to: ${filePath}`);
				}

				console.log(`Avatar uploaded successfully to: ${filePath}`);

				// Generate the public URL path
				const publicPath = `/avatars/uploads/${fileName}`;

				// Clean up old custom avatar if it exists and is in the uploads directory
				if (
					oldImagePath &&
					oldImagePath.startsWith("/avatars/uploads/") &&
					oldImagePath !== publicPath
				) {
					const oldFilePath = path.join(publicDir, oldImagePath);
					if (fs.existsSync(oldFilePath)) {
						try {
							fs.unlinkSync(oldFilePath);
							console.log(`Deleted old avatar: ${oldFilePath}`);
						} catch (error) {
							// Log but don't fail if cleanup fails
							console.error("Failed to delete old avatar:", error);
						}
					}
				}

				return { imagePath: publicPath };
			} catch (error) {
				console.error("Error uploading profile picture:", error);
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to upload profile picture: ${errorMessage}`,
				});
			}
		}),
	update: protectedProcedure
		.input(apiUpdateUser)
		.mutation(async ({ input, ctx }) => {
			if (input.password || input.currentPassword) {
				const currentAuth = await db.query.account.findFirst({
					where: eq(account.userId, ctx.user.id),
				});
				const correctPassword = bcrypt.compareSync(
					input.currentPassword || "",
					currentAuth?.password || "",
				);

				if (!correctPassword) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is incorrect",
					});
				}

				if (!input.password) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "New password is required",
					});
				}
				await db
					.update(account)
					.set({
						password: bcrypt.hashSync(input.password, 10),
					})
					.where(eq(account.userId, ctx.user.id));
			}
			return await updateUser(ctx.user.id, input);
		}),
	getUserByToken: publicProcedure
		.input(apiFindOneToken)
		.query(async ({ input }) => {
			return await getUserByToken(input.token);
		}),
	getMetricsToken: protectedProcedure.query(async ({ ctx }) => {
		const user = await findUserById(ctx.user.ownerId);
		return {
			serverIp: user.serverIp,
			enabledFeatures: user.enablePaidFeatures,
			metricsConfig: user?.metricsConfig,
		};
	}),
	remove: protectedProcedure
		.input(
			z.object({
				userId: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			if (IS_CLOUD) {
				return true;
			}
			return await removeUserById(input.userId);
		}),
	assignPermissions: adminProcedure
		.input(apiAssignPermissions)
		.mutation(async ({ input, ctx }) => {
			try {
				const organization = await findOrganizationById(
					ctx.session?.activeOrganizationId || "",
				);

				if (organization?.ownerId !== ctx.user.ownerId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not allowed to assign permissions",
					});
				}

				const { id, ...rest } = input;

				await db
					.update(member)
					.set({
						...rest,
					})
					.where(
						and(
							eq(member.userId, input.id),
							eq(
								member.organizationId,
								ctx.session?.activeOrganizationId || "",
							),
						),
					);
			} catch (error) {
				throw error;
			}
		}),
	getInvitations: protectedProcedure.query(async ({ ctx }) => {
		return await db.query.invitation.findMany({
			where: and(
				eq(invitation.email, ctx.user.email),
				gt(invitation.expiresAt, new Date()),
				eq(invitation.status, "pending"),
			),
			with: {
				organization: true,
			},
		});
	}),

	getContainerMetrics: protectedProcedure
		.input(
			z.object({
				url: z.string(),
				token: z.string(),
				appName: z.string(),
				dataPoints: z.string(),
			}),
		)
		.query(async ({ input }) => {
			try {
				if (!input.appName) {
					throw new Error(
						[
							"No Application Selected:",
							"",
							"Make Sure to select an application to monitor.",
						].join("\n"),
					);
				}
				const url = new URL(`${input.url}/metrics/containers`);
				url.searchParams.append("limit", input.dataPoints);
				url.searchParams.append("appName", input.appName);
				const response = await fetch(url.toString(), {
					headers: {
						Authorization: `Bearer ${input.token}`,
					},
				});
				if (!response.ok) {
					throw new Error(
						`Error ${response.status}: ${response.statusText}. Please verify that the application "${input.appName}" is running and this service is included in the monitoring configuration.`,
					);
				}

				const data = await response.json();
				if (!Array.isArray(data) || data.length === 0) {
					throw new Error(
						[
							`No monitoring data available for "${input.appName}". This could be because:`,
							"",
							"1. The container was recently started - wait a few minutes for data to be collected",
							"2. The container is not running - verify its status",
							"3. The service is not included in your monitoring configuration",
						].join("\n"),
					);
				}
				return data as {
					containerId: string;
					containerName: string;
					containerImage: string;
					containerLabels: string;
					containerCommand: string;
					containerCreated: string;
				}[];
			} catch (error) {
				throw error;
			}
		}),

	generateToken: protectedProcedure.mutation(async () => {
		return "token";
	}),

	deleteApiKey: protectedProcedure
		.input(
			z.object({
				apiKeyId: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			try {
				const apiKeyToDelete = await db.query.apikey.findFirst({
					where: eq(apikey.id, input.apiKeyId),
				});

				if (!apiKeyToDelete) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "API key not found",
					});
				}

				if (apiKeyToDelete.userId !== ctx.user.id) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to delete this API key",
					});
				}

				await db.delete(apikey).where(eq(apikey.id, input.apiKeyId));
				return true;
			} catch (error) {
				throw error;
			}
		}),

	createApiKey: protectedProcedure
		.input(apiCreateApiKey)
		.mutation(async ({ input, ctx }) => {
			const apiKey = await createApiKey(ctx.user.id, input);
			return apiKey;
		}),

	checkUserOrganizations: protectedProcedure
		.input(
			z.object({
				userId: z.string(),
			}),
		)
		.query(async ({ input }) => {
			const organizations = await db.query.member.findMany({
				where: eq(member.userId, input.userId),
			});

			return organizations.length;
		}),
	sendInvitation: adminProcedure
		.input(
			z.object({
				invitationId: z.string().min(1),
				notificationId: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (IS_CLOUD) {
				return;
			}

			const notification = await findNotificationById(input.notificationId);

			const email = notification.email;

			const currentInvitation = await db.query.invitation.findFirst({
				where: eq(invitation.id, input.invitationId),
			});

			if (!email) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Email notification not found",
				});
			}

			const admin = await findAdmin();
			const host =
				process.env.NODE_ENV === "development"
					? "http://localhost:3000"
					: admin.user.host;
			const inviteLink = `${host}/invitation?token=${input.invitationId}`;

			const organization = await findOrganizationById(
				ctx.session.activeOrganizationId,
			);

			try {
				await sendEmailNotification(
					{
						...email,
						toAddresses: [currentInvitation?.email || ""],
					},
					"Invitation to join organization",
					`
				<p>You are invited to join ${organization?.name || "organization"} on Dokploy. Click the link to accept the invitation: <a href="${inviteLink}">Accept Invitation</a></p>
					`,
				);
			} catch (error) {
				console.log(error);
				throw error;
			}
			return inviteLink;
		}),
});
