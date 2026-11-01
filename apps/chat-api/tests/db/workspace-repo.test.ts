import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WorkspaceRepo, WorkspaceError } from '../../src/db/repositories/workspace-repo.js';
import { AdminUserRepo, AdminUserError } from '../../src/db/repositories/admin-user-repo.js';
import { UserRepo, hashPassword } from '../../src/db/repositories/user-repo.js';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const password = hashPassword('WorkspaceRepo123!test');

describe('WorkspaceRepo & Workspace-Scoped AdminUserRepo with real PostgreSQL', () => {
  const schema = `ws_repo_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let wsRepo: WorkspaceRepo;
  let adminRepo: AdminUserRepo;
  let userRepo: UserRepo;
  let now: number;

  const createUser = async (name: string, status: 'active' | 'pending' | 'disabled' = 'active') => {
    const id = randomUUID();
    const email = `${id}@example.test`;
    await pool.query(
      'INSERT INTO users (id, email, password, name, status, email_verified) VALUES ($1, $2, $3, $4, $5, true)',
      [id, email, password, name, status]
    );
    return { id, email, name, status };
  };

  const createSession = async (userId: string) => {
    const s = await userRepo.sessions.create(userId, 'TestAgent', now);
    return s.sessionId;
  };

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href, max: 12 });

    for (const f of (await readdir(directory)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }

    wsRepo = new WorkspaceRepo(pool);
    adminRepo = new AdminUserRepo(pool);
    userRepo = new UserRepo(pool);
  });

  beforeEach(() => {
    now = Date.now();
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  describe('WorkspaceRepo CRUD & Invite Code lifecycle', () => {
    it('creates a workspace with valid ATI-XXXX-XXXX invite code and creator as active admin', async () => {
      const creator = await createUser('Creator A');
      const ws = await wsRepo.create(creator.id, 'Công ty Alpha');

      expect(ws.id).toBeDefined();
      expect(ws.name).toBe('Công ty Alpha');
      expect(ws.role).toBe('admin');
      expect(ws.status).toBe('active');
      expect(ws.requireApproval).toBe(true);
      expect(ws.inviteCode).toMatch(/^ATI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(ws.pendingCount).toBe(0);

      const member = await wsRepo.findMember(ws.id, creator.id);
      expect(member).toMatchObject({
        workspaceId: ws.id,
        workspaceName: 'Công ty Alpha',
        userId: creator.id,
        role: 'admin',
        status: 'active',
      });
    });

    it('validates workspace name constraints', async () => {
      const u = await createUser('User V');
      await expect(wsRepo.create(u.id, '')).rejects.toThrow(WorkspaceError);
      await expect(wsRepo.create(u.id, '   ')).rejects.toThrow(WorkspaceError);
      await expect(wsRepo.create(u.id, 'x'.repeat(101))).rejects.toThrow(WorkspaceError);
    });

    it('listForUser returns workspaces with inviteCode and pendingCount for admins, hides for members', async () => {
      const adminUser = await createUser('Admin L');
      const normalUser = await createUser('Member L');

      const ws = await wsRepo.create(adminUser.id, 'Tổ chức Quản lý');
      // Normal user joins
      await wsRepo.joinByInviteCode(normalUser.id, ws.inviteCode!);

      // Admin list: has inviteCode and pendingCount = 1
      const adminList = await wsRepo.listForUser(adminUser.id);
      const adminWs = adminList.find(w => w.id === ws.id);
      expect(adminWs).toBeDefined();
      expect(adminWs!.inviteCode).toBe(ws.inviteCode);
      expect(adminWs!.requireApproval).toBe(true);
      expect(adminWs!.pendingCount).toBe(1);

      // Normal user list: does NOT reveal inviteCode or requireApproval or pendingCount
      const memberList = await wsRepo.listForUser(normalUser.id);
      const memberWs = memberList.find(w => w.id === ws.id);
      expect(memberWs).toBeDefined();
      expect(memberWs!.role).toBe('member');
      expect(memberWs!.status).toBe('pending');
      expect(memberWs!.inviteCode).toBeUndefined();
      expect(memberWs!.pendingCount).toBeUndefined();
    });

    it('joins workspace by invite code: normalizes case/whitespace, handles requireApproval true and false', async () => {
      const adminUser = await createUser('Admin Join');
      const user1 = await createUser('User Pending');
      const user2 = await createUser('User Direct');

      const ws = await wsRepo.create(adminUser.id, 'Tổ chức Xét duyệt', true);

      // 1. Join with whitespace and lowercase
      const messyCode = `  ${ws.inviteCode!.toLowerCase()}  `;
      const join1 = await wsRepo.joinByInviteCode(user1.id, messyCode);
      expect(join1.created).toBe(true);
      expect(join1.workspace.status).toBe('pending');
      expect(join1.workspace.role).toBe('member');
      expect(join1.admins).toHaveLength(1);
      expect(join1.admins[0].id).toBe(adminUser.id);

      // Idempotent join returns existing membership
      const joinAgain = await wsRepo.joinByInviteCode(user1.id, ws.inviteCode!);
      expect(joinAgain.created).toBe(false);
      expect(joinAgain.workspace.status).toBe('pending');

      // 2. Admin turns off requireApproval
      await wsRepo.updateSettings(adminUser.id, ws.id, { requireApproval: false });

      // User2 joins and enters directly with status active
      const join2 = await wsRepo.joinByInviteCode(user2.id, ws.inviteCode!);
      expect(join2.created).toBe(true);
      expect(join2.workspace.status).toBe('active');
      expect(join2.admins).toHaveLength(0);

      // 3. Invalid code throws 404
      await expect(wsRepo.joinByInviteCode(user1.id, 'ATI-NONO-0000')).rejects.toThrow(WorkspaceError);
    });

    it('rejects join if user is disabled in that workspace with 403 WORKSPACE_MEMBER_DISABLED', async () => {
      const adminUser = await createUser('Admin Dis');
      const targetUser = await createUser('Disabled Target');

      const ws = await wsRepo.create(adminUser.id, 'Tổ chức Chặn');
      await wsRepo.joinByInviteCode(targetUser.id, ws.inviteCode!);

      // Mark targetUser disabled in workspace
      await pool.query('UPDATE workspace_members SET status = $1 WHERE workspace_id = $2 AND user_id = $3', ['disabled', ws.id, targetUser.id]);

      await expect(wsRepo.joinByInviteCode(targetUser.id, ws.inviteCode!)).rejects.toThrowError(
        expect.objectContaining({ status: 403, code: 'WORKSPACE_MEMBER_DISABLED' })
      );
    });

    it('regenerateInviteCode changes the code without losing existing pending members', async () => {
      const adminUser = await createUser('Admin Regen');
      const pendingUser = await createUser('Pending Persist');
      const newUser = await createUser('New Joiner');

      const ws = await wsRepo.create(adminUser.id, 'Tổ chức Đổi mã');
      const oldCode = ws.inviteCode!;

      await wsRepo.joinByInviteCode(pendingUser.id, oldCode);

      // Regenerate code
      const newCode = await wsRepo.regenerateInviteCode(adminUser.id, ws.id);
      expect(newCode).not.toBe(oldCode);
      expect(newCode).toMatch(/^ATI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

      // Old code is now invalid for new users
      await expect(wsRepo.joinByInviteCode(newUser.id, oldCode)).rejects.toThrow(WorkspaceError);

      // New code works for new users
      const newJoin = await wsRepo.joinByInviteCode(newUser.id, newCode);
      expect(newJoin.created).toBe(true);

      // Existing pending user is untouched
      const pendingMember = await wsRepo.findMember(ws.id, pendingUser.id);
      expect(pendingMember!.status).toBe('pending');

      // Non-admin cannot regenerate code
      await expect(wsRepo.regenerateInviteCode(pendingUser.id, ws.id)).rejects.toThrow(WorkspaceError);
    });
  });

  describe('AdminUserRepo workspace-scoped administration', () => {
    it('lists workspace members with pagination, filter, inviteCode and requireApproval', async () => {
      const adminUser = await createUser('Admin Org 1');
      const member1 = await createUser('Member Alpha');
      const member2 = await createUser('Member Beta');

      const ws = await wsRepo.create(adminUser.id, 'Tổ chức Báo cáo');
      await wsRepo.joinByInviteCode(member1.id, ws.inviteCode!);
      await wsRepo.joinByInviteCode(member2.id, ws.inviteCode!);

      const list = await adminRepo.listForWorkspace(adminUser.id, ws.id, { page: 1, limit: 10 });
      expect(list.total).toBe(3); // admin + 2 pending
      expect(list.pendingCount).toBe(2);
      expect(list.inviteCode).toBe(ws.inviteCode);
      expect(list.requireApproval).toBe(true);
      expect(list.workspaceName).toBe('Tổ chức Báo cáo');
      expect(list.users).toHaveLength(3);

      // Filter by status=pending
      const pendingOnly = await adminRepo.listForWorkspace(adminUser.id, ws.id, { status: 'pending', page: 1, limit: 10 });
      expect(pendingOnly.total).toBe(2);

      // Non-admin actor is forbidden
      await expect(
        adminRepo.listForWorkspace(member1.id, ws.id, { page: 1, limit: 10 })
      ).rejects.toThrow(AdminUserError);
    });

    it('mutates member in workspace: approve, reject, disable, enable, role and preserves global status', async () => {
      const adminUser = await createUser('Admin Mutate');
      const memberUser = await createUser('Member To Mutate');
      const adminSession = await createSession(adminUser.id);

      const ws = await wsRepo.create(adminUser.id, 'Tổ chức Thử nghiệm');
      await wsRepo.joinByInviteCode(memberUser.id, ws.inviteCode!);

      // 1. Approve member
      const approved = await adminRepo.mutateForWorkspace(adminUser.id, adminSession, ws.id, memberUser.id, 'approve');
      expect(approved.user?.status).toBe('active');
      expect(approved.user?.role).toBe('member');

      // Global user table status remains active and unaffected
      const globalUser = await userRepo.findById(memberUser.id);
      expect(globalUser!.status).toBe('active');

      // 2. Promote to admin
      const promoted = await adminRepo.mutateForWorkspace(adminUser.id, adminSession, ws.id, memberUser.id, 'role', 'admin');
      expect(promoted.user?.role).toBe('admin');

      // 3. Demote back to member
      const demoted = await adminRepo.mutateForWorkspace(adminUser.id, adminSession, ws.id, memberUser.id, 'role', 'member');
      expect(demoted.user?.role).toBe('member');

      // 4. Disable member in this workspace
      const disabled = await adminRepo.mutateForWorkspace(adminUser.id, adminSession, ws.id, memberUser.id, 'disable');
      expect(disabled.user?.status).toBe('disabled');
      // Global status still active
      expect((await userRepo.findById(memberUser.id))!.status).toBe('active');

      // 5. Enable member back to active
      const enabled = await adminRepo.mutateForWorkspace(adminUser.id, adminSession, ws.id, memberUser.id, 'enable');
      expect(enabled.user?.status).toBe('active');

      // 6. Reject pending member (delete from workspace_members)
      const rejectTarget = await createUser('Reject Target');
      await wsRepo.joinByInviteCode(rejectTarget.id, ws.inviteCode!);
      const rejected = await adminRepo.mutateForWorkspace(adminUser.id, adminSession, ws.id, rejectTarget.id, 'reject');
      expect(rejected.rejectedId).toBe(rejectTarget.id);
      expect(await wsRepo.findMember(ws.id, rejectTarget.id)).toBeNull();

      // Trying to reject an active member throws 409
      await expect(
        adminRepo.mutateForWorkspace(adminUser.id, adminSession, ws.id, memberUser.id, 'reject')
      ).rejects.toThrow(AdminUserError);
    });

    it('enforces LAST_ACTIVE_ADMIN in workspace: cannot disable or demote the last admin', async () => {
      const soleAdmin = await createUser('Sole Admin');
      const soleSession = await createSession(soleAdmin.id);
      const ws = await wsRepo.create(soleAdmin.id, 'Tổ chức Độc nhất');

      // Cannot self-demote or self-disable
      await expect(
        adminRepo.mutateForWorkspace(soleAdmin.id, soleSession, ws.id, soleAdmin.id, 'disable')
      ).rejects.toThrow(AdminUserError);

      await expect(
        adminRepo.mutateForWorkspace(soleAdmin.id, soleSession, ws.id, soleAdmin.id, 'role', 'member')
      ).rejects.toThrow(AdminUserError);
    });

    it('prevents admin of Org A from modifying Org B', async () => {
      const adminA = await createUser('Admin A');
      const adminB = await createUser('Admin B');
      const memberB = await createUser('Member B');
      const sessionA = await createSession(adminA.id);

      const wsA = await wsRepo.create(adminA.id, 'Tổ chức A');
      const wsB = await wsRepo.create(adminB.id, 'Tổ chức B');
      await wsRepo.joinByInviteCode(memberB.id, wsB.inviteCode!);

      // Admin A tries to approve Member B in Org B
      await expect(
        adminRepo.mutateForWorkspace(adminA.id, sessionA, wsB.id, memberB.id, 'approve')
      ).rejects.toThrow(AdminUserError);
    });

    it('approveAllForWorkspace approves all pending members in one transaction', async () => {
      const adminUser = await createUser('Admin Batch');
      const session = await createSession(adminUser.id);
      const ws = await wsRepo.create(adminUser.id, 'Tổ chức Duyệt Hàng Loạt');

      const u1 = await createUser('Pending 1');
      const u2 = await createUser('Pending 2');
      const u3 = await createUser('Pending 3');

      await wsRepo.joinByInviteCode(u1.id, ws.inviteCode!);
      await wsRepo.joinByInviteCode(u2.id, ws.inviteCode!);
      await wsRepo.joinByInviteCode(u3.id, ws.inviteCode!);

      const result = await adminRepo.approveAllForWorkspace(adminUser.id, session, ws.id);
      expect(result.approvedCount).toBe(3);
      expect(result.approvedUsers).toHaveLength(3);
      expect(result.approvedUsers.every(u => u.status === 'active')).toBe(true);

      const remainingPending = await adminRepo.listForWorkspace(adminUser.id, ws.id, { status: 'pending', page: 1, limit: 10 });
      expect(remainingPending.total).toBe(0);
    });
  });
});
