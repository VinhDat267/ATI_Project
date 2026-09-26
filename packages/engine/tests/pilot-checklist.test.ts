import { expect, it, describe } from 'vitest';
import {
  evaluateChecklist,
  computeSourceRevision,
  PILOT_CHECKLIST_VERSION,
} from '../src/pilot/checklist.js';
import type { SourceRow } from '../src/pilot/source.js';

const baseWebChange: SourceRow = {
  request_id: 'REQ-001',
  client_ref: 'Acme Corp',
  request_type: 'web_change',
  raw_request: 'Update landing page header copy to "New Era". See https://acme.com/home',
  deliverable: 'Website copy update on https://acme.com/home',
  due_date: '2026-10-15',
  decision_status: 'confirmed',
  source_note: 'Approved by client via email',
};

const baseDesignAsset: SourceRow = {
  request_id: 'REQ-002',
  client_ref: 'Beta Brand',
  request_type: 'design_asset',
  raw_request: 'Create Instagram banner 1080x1080 with product photo and 20% OFF badge',
  deliverable: 'Banner 1080x1080 for Instagram',
  due_date: '2026-10-20',
  decision_status: 'approved',
  source_note: 'Brand assets in drive link',
};

describe('pilot/checklist', () => {
  it('passes a fully specified web_change request', () => {
    const res = evaluateChecklist(baseWebChange);
    expect(res.status).toBe('pass');
    expect(res.missingFields).toEqual([]);
    expect(res.conflicts).toEqual([]);
    expect(res.unconfirmedBusiness).toBe(false);
    expect(res.checklistVersion).toBe(PILOT_CHECKLIST_VERSION);
    expect(typeof res.sourceRevision).toBe('string');
    expect(res.sourceRevision.length).toBe(64);
  });

  it('passes a fully specified design_asset request', () => {
    const res = evaluateChecklist(baseDesignAsset);
    expect(res.status).toBe('pass');
    expect(res.missingFields).toEqual([]);
    expect(res.unconfirmedBusiness).toBe(false);
  });

  it.each(['A4', 'a4'])('accepts explicit paper size %s as dimensions evidence', (paperSize) => {
    const row: SourceRow = {
      ...baseDesignAsset,
      raw_request: `Create a ${paperSize} flyer for the holiday sale`,
      deliverable: 'Print-ready flyer',
    };
    const res = evaluateChecklist(row);
    expect(res.status).toBe('pass');
    expect(res.missingFields).toEqual([]);
    expect(res.evidencePositions.dimensions).toBe('detected in request context');
    expect(res.evidencePositions.raw_request).toBe(row.raw_request);
    expect(res.checklistVersion).toBe('pilot-checklist-3');
    expect(res.sourceRevision).not.toBe(computeSourceRevision(row, 'pilot-checklist-2'));
  });

  it.each(['A40', 'BA4', 'A4X'])('does not treat embedded token %s as A4 dimensions', (token) => {
    const res = evaluateChecklist({
      ...baseDesignAsset,
      raw_request: `Create a banner for campaign ${token}`,
      deliverable: 'Banner graphic',
    });
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('dimensions');
    expect(res.evidencePositions.dimensions).toBeUndefined();
  });

  it('still requires a verified assignee for an A4 design request', () => {
    const res = evaluateChecklist({
      ...baseDesignAsset,
      raw_request: 'Create an A4 flyer; assign John Doe this ticket',
      deliverable: 'Print-ready flyer',
    });
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toEqual(['assignee_id']);
  });

  it('detects missing or non-calendar deadline (e.g. "thứ Sáu")', () => {
    const missingDate = { ...baseWebChange, due_date: '' };
    expect(evaluateChecklist(missingDate).status).toBe('needs_input');
    expect(evaluateChecklist(missingDate).missingFields).toContain('due_date');

    const vagueDate = { ...baseWebChange, due_date: 'thứ Sáu tới' };
    expect(evaluateChecklist(vagueDate).status).toBe('needs_input');
    expect(evaluateChecklist(vagueDate).missingFields).toContain('due_date');
  });

  it('detects missing target URL for web_change', () => {
    const noUrl: SourceRow = {
      ...baseWebChange,
      raw_request: 'Update landing page header copy to "New Era"',
      deliverable: 'Landing page copy update',
      source_note: '',
    };
    const res = evaluateChecklist(noUrl);
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('target_url');
  });

  it('detects missing dimensions or content for design_asset', () => {
    const noDimensions: SourceRow = {
      ...baseDesignAsset,
      raw_request: 'Create social banner for holiday sale',
      deliverable: 'Banner graphic',
    };
    const res = evaluateChecklist(noDimensions);
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('dimensions');
  });

  it('flags unconfirmed business decision', () => {
    const unconfirmed = { ...baseWebChange, decision_status: 'pending client review' };
    const res = evaluateChecklist(unconfirmed);
    expect(res.unconfirmedBusiness).toBe(true);
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('decision_status');
  });

  it('detects conflicting requirements when flagged in notes or raw request', () => {
    const conflicting = {
      ...baseWebChange,
      raw_request: 'Change hero background to dark blue. Or keep white as alternative? Chưa chốt màu nền.',
    };
    const res = evaluateChecklist(conflicting);
    expect(res.status).toBe('needs_input');
    expect(res.conflicts.length).toBeGreaterThan(0);
  });

  it.each([
    'Viết bài tại https://acme.com/home giao cho Nguyễn Văn A nhưng trùng tên',
    'Assign the update at https://acme.com/home to John Doe',
    'Update https://acme.com/home; assignee: member_123',
    'Nguyễn Văn A phụ trách cập nhật https://acme.com/home',
    'Owner: John Doe, update https://acme.com/home',
    'Assign John Doe this ticket at https://acme.com/home',
    'Update https://acme.com/home; assignee_id: member_123',
    'Update https://acme.com/home; assigned_to: John Doe',
    'Nhờ Nguyễn Văn A thực hiện cập nhật https://acme.com/home',
    'John Doe will handle the update at https://acme.com/home',
  ])('asks for a verified Trello member before assignment: %s', (raw_request) => {
    const res = evaluateChecklist({ ...baseWebChange, raw_request });
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('assignee_id');
  });

  it('does not mistake an unrelated person mention for assignment', () => {
    const res = evaluateChecklist({ ...baseWebChange, source_note: 'Approved by John Doe via email' });
    expect(res.status).toBe('pass');
  });

  it('computes stable deterministic sourceRevision and isolates changes', () => {
    const rev1 = computeSourceRevision(baseWebChange);
    const rev2 = computeSourceRevision({ ...baseWebChange });
    expect(rev1).toBe(rev2);

    const changed = { ...baseWebChange, due_date: '2026-10-16' };
    expect(computeSourceRevision(changed)).not.toBe(rev1);

    expect(computeSourceRevision(baseWebChange, 'custom-v2')).not.toBe(rev1);
  });
});
