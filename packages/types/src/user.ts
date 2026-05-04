export interface UserDto {
  id: string;
  kakaoId: string;
  nickname: string;
  profileImageUrl?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserDto {
  nickname?: string;
  profileImageUrl?: string;
}
