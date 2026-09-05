export interface IUpdateProfilePayload {
	name: string;
}

export interface IChangePasswordPayload {
	currentPassword: string;
	newPassword: string;
}
