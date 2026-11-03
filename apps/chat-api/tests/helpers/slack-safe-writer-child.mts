/** Child-process fixture: real SQL repositories and real HTTP, no authority boolean mocks. */
import pg from 'pg';
import {SlackSafeWriter} from '../../src/services/slack/slack-safe-writer.js';
import {SlackConnectionRepo} from '../../src/db/repositories/slack-connection-repo.js';
import {SlackInvalidationService} from '../../src/services/slack/slack-invalidation-service.js';
import {SlackPolicyService} from '../../src/services/slack/policy-service.js';
import {SlackOAuthClient} from '../../src/services/slack/oauth-client.js';
import {SlackTokenManager} from '../../src/services/slack/token-manager.js';
let raw='';for await(const c of process.stdin)raw+=c;
const {input,mode,endpoint}=JSON.parse(raw),pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),invalidation=new SlackInvalidationService(pool),policy=new SlackPolicyService(pool,{env:JSON.parse(process.env.FIXTURE_POLICY_ENV!)});
try{
 const writer=new SlackSafeWriter({pool,apiBaseUrl:endpoint,tokens:new SlackTokenManager(new SlackConnectionRepo(pool,invalidation),new SlackOAuthClient({appId:input.appId,clientId:'fixture',clientSecret:'fixture',redirectUri:'http://127.0.0.1/callback',authorizationUrl:'https://slack.com/oauth/v2/authorize',apiBaseUrl:endpoint}),process.env.FIXTURE_KEY!),
  authorize:async(i,c)=>{const d=await policy.resolveSlackModelPolicy({binding:i.binding,purpose:'planning',requestedRetentionDays:0},c);if(!d.allowed||(await invalidation.checkBarriers({binding:i.binding,channelId:i.params.channel},c)).blocked)throw new Error('DENIED');}});
 try{const result=await writer[mode==='reconcile'?'reconcile':'execute'](input);process.stdout.write(JSON.stringify(result));}
 catch(e){process.stdout.write(JSON.stringify({category:(e as any).category}));}
}finally{await pool.end();}
