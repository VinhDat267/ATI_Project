import {Router} from 'express';
import {createAuthMiddleware,type AuthUser} from '../auth/jwt.js';
import type {SessionRepo} from '../db/repositories/session-repo.js';
import type {SlackAssistantRepo} from '../db/repositories/slack-assistant-repo.js';
import type {SlackAssistantArtifactRepo} from '../db/repositories/slack-assistant-artifact-repo.js';
export interface SlackAssistantServices {repo:SlackAssistantRepo;artifacts:SlackAssistantArtifactRepo}
function only(value:unknown,keys:string[]):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new TypeError('SLACK_ASSISTANT_INVALID');return value as Record<string,any>;}
export function createSlackAssistantRoutes(options:SlackAssistantServices&{jwtSecret:string;sessionRepo:SessionRepo}){
 const router=Router(),auth=createAuthMiddleware(options.jwtSecret,{sessionRepo:options.sessionRepo});
 router.use(['/api/connections/myslack/:connectionId/assistant','/api/slack/proposals'],(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},auth,(req,res,next)=>{if(!(req as any).user?.sid){res.status(401).json({code:'INVALID_SESSION',error:'Phiên đăng nhập đã hết hạn.'});return;}next();});
 const owner=(req:any)=>(req.user as AuthUser).id;
 const fail=(res:any,e:unknown)=>{
  const message=e instanceof Error?e.message:'',code=e instanceof TypeError?'SLACK_ASSISTANT_INVALID':['SLACK_ASSISTANT_NOT_FOUND','SLACK_PROPOSAL_NOT_FOUND','SLACK_ASSISTANT_VERSION_CONFLICT','SLACK_PROPOSAL_VERSION_CONFLICT','SLACK_POLICY_DENIED','SLACK_AUTOMATION_UNAVAILABLE'].includes(message)?message:'SLACK_ASSISTANT_UNAVAILABLE';
  const status=code.endsWith('NOT_FOUND')?404:code.endsWith('VERSION_CONFLICT')?409:code==='SLACK_ASSISTANT_INVALID'?400:code==='SLACK_POLICY_DENIED'?403:503;
  res.status(status).json({code,error:status===409?'Cấu hình đã thay đổi. Hãy tải lại trước khi lưu.':status===403?'Workspace chưa cho phép xử lý dữ liệu này.':status===503?'Tự động hóa Slack chưa khả dụng.':'Không thực hiện được yêu cầu Slack.'});
 };
 router.get('/api/connections/myslack/:connectionId/assistant',async(req,res)=>{try{res.json(await options.repo.getConfig(owner(req),req.params.connectionId));}catch(e){fail(res,e);}});
 router.put('/api/connections/myslack/:connectionId/assistant',async(req,res)=>{try{const body=only(req.body,['expectedVersion','config']);res.json(await options.repo.updateConfig(owner(req),req.params.connectionId,body.expectedVersion,body.config));}catch(e){fail(res,e);}});
 router.put('/api/connections/myslack/:connectionId/assistant/followed-threads',async(req,res)=>{try{const body=only(req.body,['channelId','threadTs','follow']);await options.repo.followThread(owner(req),req.params.connectionId,body.channelId,body.threadTs,body.follow);res.json({success:true});}catch(e){fail(res,e);}});
 router.get('/api/slack/proposals',async(req,res)=>{try{if(typeof req.query.connectionId!=='string'||Object.keys(req.query).length!==1)throw new TypeError('SLACK_ASSISTANT_INVALID');res.json({proposals:await options.artifacts.list(owner(req),req.query.connectionId)});}catch(e){fail(res,e);}});
 return router;
}
