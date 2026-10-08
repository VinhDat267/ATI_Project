export interface PendingUser { id: string; name: string; email: string; provider: string; emailVerified: boolean; requestedAt: string; avatarInitials: string }
export interface Member { id: string; name: string; email: string; role: 'admin' | 'member'; status: 'active' | 'locked'; joinedDate: string; sessionsCount: number; avatarInitials: string; isSelf: boolean }

