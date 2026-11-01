import {describe,it,expect} from 'vitest';
import {planSlackProposalWorkflow} from '../src/slack-proposal-plan.js';

const binding={atiUserId:'00000000-0000-4000-8000-000000000001',connectionId:'00000000-0000-4000-8000-000000000002',workspaceId:'T_ONE',slackUserId:'U_ONE',identityVersion:1};
const policyReference={binding,purpose:'planning' as const,requestedRetentionDays:1,providerProfileId:'provider',configFingerprint:'a'.repeat(64),policyVersion:'v1.0.0',consentRevision:'1',providerRevision:'1'};

describe('planSlackProposalWorkflow cross-service planning',()=>{
 it('plans Trello task creation + optional source-bound Slack thread reply referencing certified card URL',()=>{
  const res=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_WORK',messageTs:'1730000000.000100',threadTs:'1730000000.000050'},
   proposal:{
    title:'Chuẩn bị báo cáo Q4',
    rationale:'Được nhắc trực tiếp trong kênh dự án',
    intents:[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo Q4 cho khách hàng'}],
    sourceTexts:['<@U_ONE> chuẩn bị báo cáo Q4 nhé'],
   },
   targets:{task:{listId:'L_TODO',allowedListIds:['L_TODO']},replyInThread:true},
  });
  expect(res.kind).toBe('plan');
  if(res.kind!=='plan')return;
  expect(res.plan.steps).toHaveLength(2);
  expect(res.plan.steps[0]).toMatchObject({
   id:'step_1',
   tool:'trello.create_card',
   args:{listId:'L_TODO',title:'Chuẩn bị báo cáo Q4',desc:'Chuẩn bị báo cáo Q4 cho khách hàng'},
   dependsOn:[],
  });
  expect(res.plan.steps[1]).toMatchObject({
   id:'step_2',
   tool:'myslack.chat_postMessage',
   args:{channel:'C_WORK',thread_ts:'1730000000.000050',text:{$template:'Đã tạo thẻ công việc: ${step_1.output.url}'}},
   dependsOn:['step_1'],
  });
 });

 it('returns needs_info when Slack message has a vague deadline and no explicit date or clarification',()=>{
  const vague=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_WORK',messageTs:'1730000000.000100'},
   proposal:{
    title:'Chuẩn bị báo cáo',
    rationale:'Nhờ trực tiếp kèm hạn mơ hồ',
    intents:[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo',deadlineText:'thứ Sáu tuần sau'}],
    sourceTexts:['<@U_ONE> chuẩn bị báo cáo vào thứ Sáu tuần sau nhé'],
   },
   targets:{task:{listId:'L_TODO',allowedListIds:['L_TODO']}},
  });
  expect(vague.kind).toBe('needs_info');

  const clarified=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_WORK',messageTs:'1730000000.000100'},
   proposal:{
    title:'Chuẩn bị báo cáo',
    rationale:'Nhờ trực tiếp kèm hạn mơ hồ',
    intents:[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo',deadlineText:'thứ Sáu tuần sau'}],
    sourceTexts:['<@U_ONE> chuẩn bị báo cáo vào thứ Sáu tuần sau nhé'],
   },
   targets:{task:{listId:'L_TODO',allowedListIds:['L_TODO']}},
   instruction:'Đặt hạn chót 2026-11-06',
  });
  expect(clarified.kind).toBe('plan');
  if(clarified.kind==='plan')expect(clarified.plan.steps[0]?.args).toMatchObject({due:'2026-11-06'});
 });

 it('plans Jira lookup (jira.search_issues) before jira.create_issue for bug reports',()=>{
  const res=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_BUGS',messageTs:'1730000000.000200'},
   proposal:{
    title:'Lỗi đăng nhập SSO trên mobile',
    rationale:'Báo lỗi trực tiếp',
    intents:[{action:'issue',service:'jira',summary:'Người dùng iOS không đăng nhập được qua SSO'}],
    sourceTexts:['<@U_ONE> kiểm tra lỗi đăng nhập SSO trên mobile'],
   },
   targets:{bug:{projectKey:'ATI',allowedProjectKeys:['ATI']}},
  });
  expect(res.kind).toBe('plan');
  if(res.kind!=='plan')return;
  expect(res.plan.steps.map(s=>s.tool)).toEqual(['jira.search_issues','jira.create_issue']);
  expect(res.plan.steps[1]?.dependsOn).toEqual(['step_1']);
 });

 it('enforces allowed spreadsheet scope for MySheets progress updates',()=>{
  const denied=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_PROG',messageTs:'1730000000.000300'},
   proposal:{
    title:'Cập nhật tiến độ tuần',
    rationale:'Cam kết cập nhật bảng tiến độ',
    intents:[{action:'progress',service:'mysheets',summary:'Hoàn thành 90% hạng mục M4'}],
    sourceTexts:['Tôi sẽ cập nhật tiến độ vào bảng tính'],
   },
   targets:{progress:{spreadsheetId:'spreadsheet_unallowed_1234567890',sheet:'Sprint',allowedSpreadsheetIds:['spreadsheet_allowed_1234567890']}},
  });
  expect(denied.kind).toBe('needs_info');

  const allowed=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_PROG',messageTs:'1730000000.000300'},
   proposal:{
    title:'Cập nhật tiến độ tuần',
    rationale:'Cam kết cập nhật bảng tiến độ',
    intents:[{action:'progress',service:'mysheets',summary:'Hoàn thành 90% hạng mục M4'}],
    sourceTexts:['Tôi sẽ cập nhật tiến độ vào bảng tính'],
   },
   targets:{progress:{spreadsheetId:'spreadsheet_allowed_1234567890',sheet:'Sprint',allowedSpreadsheetIds:['spreadsheet_allowed_1234567890']}},
  });
  expect(allowed.kind).toBe('plan');
  if(allowed.kind==='plan')expect(allowed.plan.steps[0]?.tool).toBe('mysheets.append_rows');
 });
});
