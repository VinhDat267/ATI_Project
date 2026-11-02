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

 it('plans direct 1-step Slack thread reply for question proposals when user provides draft reply instruction',()=>{
  const needsAnswer=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_QA',messageTs:'1730000000.000400',threadTs:'1730000000.000350'},
   proposal:{
    title:'Hỏi về lịch bảo trì hệ thống',
    rationale:'Đồng nghiệp đặt câu hỏi trực tiếp',
    intents:[{action:'question',service:'myslack',summary:'Khi nào bảo trì xong?'}],
    sourceTexts:['<@U_ONE> khi nào bảo trì xong nhỉ?'],
   },
   targets:{replyInThread:true},
  });
  expect(needsAnswer.kind).toBe('needs_info');

  const answered=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_QA',messageTs:'1730000000.000400',threadTs:'1730000000.000350'},
   proposal:{
    title:'Hỏi về lịch bảo trì hệ thống',
    rationale:'Đồng nghiệp đặt câu hỏi trực tiếp',
    intents:[{action:'question',service:'myslack',summary:'Khi nào bảo trì xong?'}],
    sourceTexts:['<@U_ONE> khi nào bảo trì xong nhỉ?'],
   },
   targets:{replyInThread:true},
   instruction:'Hệ thống sẽ hoàn tất bảo trì lúc 23:00 tối nay nhé.',
  });
  expect(answered.kind).toBe('plan');
  if(answered.kind!=='plan')return;
  expect(answered.plan.steps).toHaveLength(1);
  expect(answered.plan.steps[0]).toMatchObject({
   id:'step_1',
   tool:'myslack.chat_postMessage',
   args:{
    channel:'C_QA',
    thread_ts:'1730000000.000350',
    text:'Hệ thống sẽ hoàn tất bảo trì lúc 23:00 tối nay nhé.',
   },
   dependsOn:[],
  });
 });

 it('plans MyCalendar event creation, GitHub issue creation, and Gmail draft creation with source-bound thread replies',()=>{
  const calPlan=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_MEET',messageTs:'1730000000.000500'},
   proposal:{
    title:'Họp chốt kiến trúc v3',
    rationale:'Nhắc lịch họp trong kênh',
    intents:[{action:'task',service:'mycalendar',summary:'Họp chốt kiến trúc v3 cùng team backend'}],
    sourceTexts:['<@U_ONE> đặt lịch họp chốt kiến trúc v3 nhé'],
   },
   targets:{
    calendar:{calendarId:'primary',startIso:'2026-11-05T09:00:00+07:00',endIso:'2026-11-05T10:00:00+07:00'},
    replyInThread:true,
   },
  });
  expect(calPlan.kind).toBe('plan');
  if(calPlan.kind==='plan'){
   expect(calPlan.plan.steps.map(s=>s.tool)).toEqual(['mycalendar.create_event','myslack.chat_postMessage']);
   expect(calPlan.plan.steps[0]?.args).toMatchObject({
    calendarId:'primary',
    summary:'Họp chốt kiến trúc v3',
    start:'2026-11-05T09:00:00+07:00',
    end:'2026-11-05T10:00:00+07:00',
   });
  }

  const ghPlan=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_DEV',messageTs:'1730000000.000600'},
   proposal:{
    title:'Tối ưu truy vấn danh sách hội thoại',
    rationale:'Yêu cầu tạo issue trên GitHub',
    intents:[{action:'issue',service:'github',summary:'Thêm index cho bảng conversations'}],
    sourceTexts:['<@U_ONE> tạo GitHub issue tối ưu truy vấn nhé'],
   },
   targets:{
    github:{repo:'wap/platform',allowedRepos:['wap/platform']},
    replyInThread:true,
   },
  });
  expect(ghPlan.kind).toBe('plan');
  if(ghPlan.kind==='plan'){
   expect(ghPlan.plan.steps.map(s=>s.tool)).toEqual(['github.search_issues','github.create_issue','myslack.chat_postMessage']);
   expect(ghPlan.plan.steps[1]?.args).toMatchObject({repo:'wap/platform',title:'Tối ưu truy vấn danh sách hội thoại'});
  }

  const gmailPlan=planSlackProposalWorkflow({
   ownerId:binding.atiUserId,
   binding,
   policyReference,
   source:{channelId:'C_SALES',messageTs:'1730000000.000700'},
   proposal:{
    title:'Gửi báo giá Q4 cho đối tác',
    rationale:'Nhờ soạn email gửi khách hàng',
    intents:[{action:'task',service:'gmail',summary:'Kính gửi đối tác bản báo giá Q4 chi tiết.'}],
    sourceTexts:['<@U_ONE> soạn mail báo giá Q4 cho khách nhé'],
   },
   targets:{
    gmail:{toEmail:'partner@example.com'},
    replyInThread:true,
   },
  });
  expect(gmailPlan.kind).toBe('plan');
  if(gmailPlan.kind==='plan'){
   expect(gmailPlan.plan.steps.map(s=>s.tool)).toEqual(['gmail.create_draft','myslack.chat_postMessage']);
   expect(gmailPlan.plan.steps[0]?.args).toMatchObject({to:['partner@example.com'],subject:'Gửi báo giá Q4 cho đối tác'});
  }
 });
});
