import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { generateSHA256Hash } from "@/lib/utils";
import { api } from "@/utils/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Upload, User, X } from "lucide-react";
import { useTranslation } from "next-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Disable2FA } from "./disable-2fa";
import { Enable2FA } from "./enable-2fa";

const profileSchema = z.object({
	name: z.string().optional(),
	email: z.string(),
	password: z.string().nullable(),
	currentPassword: z.string().nullable(),
	image: z.string().optional(),
	allowImpersonation: z.boolean().optional().default(false),
});

type Profile = z.infer<typeof profileSchema>;

const randomImages = [
	"/avatars/avatar-1.png",
	"/avatars/avatar-2.png",
	"/avatars/avatar-3.png",
	"/avatars/avatar-4.png",
	"/avatars/avatar-5.png",
	"/avatars/avatar-6.png",
	"/avatars/avatar-7.png",
	"/avatars/avatar-8.png",
	"/avatars/avatar-9.png",
	"/avatars/avatar-10.png",
	"/avatars/avatar-11.png",
	"/avatars/avatar-12.png",
];

export const ProfileForm = () => {
	const _utils = api.useUtils();
	const { data, refetch, isLoading } = api.user.get.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();

	const {
		mutateAsync,
		isLoading: isUpdating,
		isError,
		error,
	} = api.user.update.useMutation();
	const {
		mutateAsync: uploadProfilePicture,
		isLoading: isUploading,
	} = api.user.uploadProfilePicture.useMutation();
	const { t } = useTranslation("settings");
	const [gravatarHash, setGravatarHash] = useState<string | null>(null);
	const [uploadPreview, setUploadPreview] = useState<string | null>(null);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const availableAvatars = useMemo(() => {
		if (gravatarHash === null) return randomImages;
		return randomImages.concat([
			`https://www.gravatar.com/avatar/${gravatarHash}`,
		]);
	}, [gravatarHash]);

	const form = useForm<Profile>({
		defaultValues: {
			name: data?.user?.name || "",
			email: data?.user?.email || "",
			password: "",
			image: data?.user?.image || "",
			currentPassword: "",
			allowImpersonation: data?.user?.allowImpersonation || false,
		},
		resolver: zodResolver(profileSchema),
	});

	useEffect(() => {
		if (data) {
			const userImage = data?.user?.image || "";
			form.reset(
				{
					name: data?.user?.name || "",
					email: data?.user?.email || "",
					password: form.getValues("password") || "",
					image: userImage,
					currentPassword: form.getValues("currentPassword") || "",
					allowImpersonation: data?.user?.allowImpersonation,
				},
				{
					keepValues: true,
				},
			);
			form.setValue("allowImpersonation", data?.user?.allowImpersonation);

			// If user has an uploaded image, set it as preview
			if (userImage && userImage.startsWith("/avatars/uploads/")) {
				setUploadPreview(userImage);
			} else {
				setUploadPreview(null);
			}

			if (data.user.email) {
				generateSHA256Hash(data.user.email).then((hash) => {
					setGravatarHash(hash);
				});
			}
		}
	}, [form, data]);

	const handleFileSelect = async (file: File | null) => {
		if (!file) {
			setSelectedFile(null);
			setUploadPreview(null);
			return;
		}

		// Validate file size (2MB max)
		const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
		if (file.size > MAX_FILE_SIZE) {
			toast.error("Image size must be less than 2MB");
			return;
		}

		// Validate file type
		const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
		if (!allowedTypes.includes(file.type)) {
			toast.error("Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed");
			return;
		}

		setSelectedFile(file);

		// Create preview
		const reader = new FileReader();
		reader.onloadend = () => {
			setUploadPreview(reader.result as string);
		};
		reader.readAsDataURL(file);
	};

	const handleUpload = async () => {
		if (!selectedFile) return;

		try {
			const formData = new FormData();
			formData.append("image", selectedFile);

			const result = await uploadProfilePicture(formData);
			if (result?.imagePath) {
				form.setValue("image", result.imagePath);
				setUploadPreview(result.imagePath);
				toast.success("Profile picture uploaded successfully");
				setSelectedFile(null);
				if (fileInputRef.current) {
					fileInputRef.current.value = "";
				}
			}
		} catch (error) {
			toast.error("Failed to upload profile picture");
		}
	};

	const onSubmit = async (values: Profile) => {
		// If there's a selected file but not uploaded yet, upload it first
		if (selectedFile && !uploadPreview?.includes("/avatars/uploads/")) {
			await handleUpload();
			// Wait a bit for the form value to update
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		await mutateAsync({
			name: values.name,
			email: values.email.toLowerCase(),
			password: values.password || undefined,
			image: values.image,
			currentPassword: values.currentPassword || undefined,
			allowImpersonation: values.allowImpersonation,
		})
			.then(async () => {
				await refetch();
				toast.success("Profile Updated");
				form.reset({
					name: values.name,
					email: values.email,
					password: "",
					image: values.image,
					currentPassword: "",
				});
				setSelectedFile(null);
				setUploadPreview(null);
			})
			.catch(() => {
				toast.error("Error updating the profile");
			});
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar  p-2.5 rounded-xl  max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md ">
					<CardHeader className="flex flex-row gap-2 flex-wrap justify-between items-center">
						<div>
							<CardTitle className="text-xl flex flex-row gap-2">
								<User className="size-6 text-muted-foreground self-center" />
								{t("settings.profile.title")}
							</CardTitle>
							<CardDescription>
								{t("settings.profile.description")}
							</CardDescription>
						</div>
						{!data?.user.twoFactorEnabled ? <Enable2FA /> : <Disable2FA />}
					</CardHeader>

					<CardContent className="space-y-2 py-8 border-t">
						{isError && <AlertBlock type="error">{error?.message}</AlertBlock>}
						{isLoading ? (
							<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[35vh]">
								<span>Loading...</span>
								<Loader2 className="animate-spin size-4" />
							</div>
						) : (
							<>
								<Form {...form}>
									<form
										onSubmit={form.handleSubmit(onSubmit)}
										className="grid gap-4"
									>
										<div className="space-y-4">
											<FormField
												control={form.control}
												name="name"
												render={({ field }) => (
													<FormItem>
														<FormLabel>{t("settings.profile.name")}</FormLabel>
														<FormControl>
															<Input
																placeholder={t("settings.profile.name")}
																{...field}
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
											<FormField
												control={form.control}
												name="email"
												render={({ field }) => (
													<FormItem>
														<FormLabel>{t("settings.profile.email")}</FormLabel>
														<FormControl>
															<Input
																placeholder={t("settings.profile.email")}
																{...field}
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
											<FormField
												control={form.control}
												name="currentPassword"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Current Password</FormLabel>
														<FormControl>
															<Input
																type="password"
																placeholder={t("settings.profile.password")}
																{...field}
																value={field.value || ""}
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
											<FormField
												control={form.control}
												name="password"
												render={({ field }) => (
													<FormItem>
														<FormLabel>
															{t("settings.profile.password")}
														</FormLabel>
														<FormControl>
															<Input
																type="password"
																placeholder={t("settings.profile.password")}
																{...field}
																value={field.value || ""}
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>

											<FormField
												control={form.control}
												name="image"
												render={({ field }) => (
													<FormItem>
														<FormLabel>
															{t("settings.profile.avatar")}
														</FormLabel>
														<FormControl>
															<div className="space-y-4">
																<RadioGroup
																	onValueChange={(e) => {
																		field.onChange(e);
																		setSelectedFile(null);
																		setUploadPreview(null);
																		if (fileInputRef.current) {
																			fileInputRef.current.value = "";
																		}
																	}}
																	defaultValue={field.value}
																	value={field.value}
																	className="flex flex-row flex-wrap gap-2 max-xl:justify-center"
																>
																	{availableAvatars.map((image) => (
																		<FormItem key={image}>
																			<FormLabel className="[&:has([data-state=checked])>img]:border-primary [&:has([data-state=checked])>img]:border-1 [&:has([data-state=checked])>img]:p-px cursor-pointer">
																				<FormControl>
																					<RadioGroupItem
																						value={image}
																						className="sr-only"
																					/>
																				</FormControl>

																				<img
																					key={image}
																					src={image}
																					alt="avatar"
																					className="h-12 w-12 rounded-full border hover:p-px hover:border-primary transition-transform"
																				/>
																			</FormLabel>
																		</FormItem>
																	))}
																	{/* Upload Option */}
																	{uploadPreview && uploadPreview.startsWith("/avatars/uploads/") && (
																		<FormItem>
																			<FormLabel className="[&:has([data-state=checked])>div>img]:border-primary [&:has([data-state=checked])>div>img]:border-1 [&:has([data-state=checked])>div>img]:p-px cursor-pointer">
																				<FormControl>
																					<RadioGroupItem
																						value={uploadPreview}
																						className="sr-only"
																					/>
																				</FormControl>
																				<div className="relative">
																					<img
																						src={uploadPreview}
																						alt="Uploaded avatar"
																						className="h-12 w-12 rounded-full border object-cover hover:p-px hover:border-primary transition-transform"
																					/>
																					<button
																						type="button"
																						onClick={(e) => {
																							e.stopPropagation();
																							setSelectedFile(null);
																							setUploadPreview(null);
																							if (fileInputRef.current) {
																								fileInputRef.current.value = "";
																							}
																							if (field.value === uploadPreview) {
																								field.onChange("");
																							}
																						}}
																						className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/90"
																					>
																						<X className="h-3 w-3" />
																					</button>
																				</div>
																			</FormLabel>
																		</FormItem>
																	)}
																	{/* Upload Button */}
																	<FormItem>
																		<FormLabel className="cursor-pointer">
																			<div className="relative">
																				<input
																					ref={fileInputRef}
																					type="file"
																					accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
																					className="hidden"
																					onChange={(e) => {
																						const file = e.target.files?.[0] || null;
																						handleFileSelect(file);
																					}}
																				/>
																				{uploadPreview && !uploadPreview.startsWith("/avatars/uploads/") ? (
																					<div className="relative">
																						<img
																							src={uploadPreview}
																							alt="Upload preview"
																							className="h-12 w-12 rounded-full border object-cover hover:p-px hover:border-primary transition-transform"
																						/>
																						<button
																							type="button"
																							onClick={(e) => {
																								e.stopPropagation();
																								setSelectedFile(null);
																								setUploadPreview(null);
																								if (fileInputRef.current) {
																									fileInputRef.current.value = "";
																								}
																							}}
																							className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/90"
																						>
																							<X className="h-3 w-3" />
																						</button>
																					</div>
																				) : (
																					<button
																						type="button"
																						onClick={() => fileInputRef.current?.click()}
																						className="h-12 w-12 rounded-full border-2 border-dashed border-muted-foreground/50 hover:border-primary hover:bg-muted/50 flex items-center justify-center transition-colors"
																					>
																						<Upload className="h-5 w-5 text-muted-foreground" />
																					</button>
																				)}
																			</div>
																		</FormLabel>
																	</FormItem>
																</RadioGroup>
																{selectedFile && uploadPreview && !uploadPreview.startsWith("/avatars/uploads/") && (
																	<div className="flex items-center gap-2">
																		<span className="text-sm text-muted-foreground">
																			{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
																		</span>
																		<Button
																			type="button"
																			size="sm"
																			onClick={handleUpload}
																			isLoading={isUploading}
																		>
																			Upload
																		</Button>
																	</div>
																)}
															</div>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
											{isCloud && (
												<FormField
													control={form.control}
													name="allowImpersonation"
													render={({ field }) => (
														<FormItem className="flex flex-row items-center justify-between p-3 mt-4 border rounded-lg shadow-sm">
															<div className="space-y-0.5">
																<FormLabel>Allow Impersonation</FormLabel>
																<FormDescription>
																	Enable this option to allow Dokploy Cloud
																	administrators to temporarily access your
																	account for troubleshooting and support
																	purposes. This helps them quickly identify and
																	resolve any issues you may encounter.
																</FormDescription>
															</div>
															<FormControl>
																<Switch
																	checked={field.value}
																	onCheckedChange={field.onChange}
																/>
															</FormControl>
														</FormItem>
													)}
												/>
											)}
										</div>

										<div className="flex items-center justify-end gap-2">
											<Button type="submit" isLoading={isUpdating}>
												{t("settings.common.save")}
											</Button>
										</div>
									</form>
								</Form>
							</>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
