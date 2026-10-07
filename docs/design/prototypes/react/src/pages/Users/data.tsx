// Dữ liệu chép nguyên văn từ docs/design/prototypes/users.html bằng scripts/extract-data.mjs; kiểu khai thêm bằng tay.
export interface PendingUser { id: string; name: string; email: string; provider: string; emailVerified: boolean; requestedAt: string; avatarInitials: string }
export interface Member { id: string; name: string; email: string; role: 'admin' | 'member'; status: 'active' | 'locked'; joinedDate: string; sessionsCount: number; avatarInitials: string; isSelf: boolean }

export const INITIAL_PENDING: PendingUser[] = [
      {
        id: 'pen_101',
        name: 'Hoàng Minh Khôi',
        email: 'khoi.hoang@congty.vn',
        provider: 'Email',
        emailVerified: true,
        requestedAt: '15 phút trước',
        avatarInitials: 'HK'
      },
      {
        id: 'pen_102',
        name: 'Lê Quỳnh Chi',
        email: 'chi.le@congty.vn',
        provider: 'Google',
        emailVerified: true,
        requestedAt: '2 giờ trước',
        avatarInitials: 'QC'
      },
      {
        id: 'pen_103',
        name: 'Phạm Đức Anh',
        email: 'ducanh.pham@congty.vn',
        provider: 'Email',
        emailVerified: false,
        requestedAt: '35 phút trước',
        avatarInitials: 'ĐA'
      }
    ];

export const INITIAL_MEMBERS: Member[] = [
      {
        id: 'usr_001',
        name: 'Lan Nguyễn',
        email: 'lan.nguyen@congty.vn',
        role: 'admin',
        status: 'active', // 'active' | 'locked'
        joinedDate: '15/01/2026',
        sessionsCount: 3,
        avatarInitials: 'LN',
        isSelf: true
      },
      {
        id: 'usr_002',
        name: 'Nguyễn Văn An',
        email: 'admin@congty.vn',
        role: 'admin',
        status: 'active',
        joinedDate: '10/01/2026',
        sessionsCount: 2,
        avatarInitials: 'NA',
        isSelf: false
      },
      {
        id: 'usr_003',
        name: 'Tuấn Đặng',
        email: 'tuan.dang@congty.vn',
        role: 'member',
        status: 'active',
        joinedDate: '02/02/2026',
        sessionsCount: 1,
        avatarInitials: 'TD',
        isSelf: false
      },
      {
        id: 'usr_004',
        name: 'Trần Mai Phương',
        email: 'phuong.tran@congty.vn',
        role: 'member',
        status: 'active',
        joinedDate: '12/02/2026',
        sessionsCount: 2,
        avatarInitials: 'MP',
        isSelf: false
      },
      {
        id: 'usr_005',
        name: 'Đỗ Thành Long',
        email: 'long.do@congty.vn',
        role: 'member',
        status: 'active',
        joinedDate: '15/02/2026',
        sessionsCount: 1,
        avatarInitials: 'TL',
        isSelf: false
      },
      {
        id: 'usr_006',
        name: 'Phạm Quốc Bảo',
        email: 'bao.pham@congty.vn',
        role: 'member',
        status: 'locked', // Đang bị tạm khóa
        joinedDate: '18/02/2026',
        sessionsCount: 0,
        avatarInitials: 'QB',
        isSelf: false
      }
    ];
