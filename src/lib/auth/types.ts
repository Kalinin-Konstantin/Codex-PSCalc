export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "approved" | "blocked";

export type UserProfile = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
};
