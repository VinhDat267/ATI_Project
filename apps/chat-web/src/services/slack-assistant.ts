import {validateSlackAssistantConfig,validateSlackAssistantSettingsView,validateSlackAssistantVersion,type SlackAssistantConfig} from '@wap/tool-schemas';
import {apiClient} from './api-client';
const path=(id:string)=>'/api/connections/myslack/'+encodeURIComponent(id)+'/assistant';
export const slackAssistantApi={
 get:async(id:string,signal?:AbortSignal)=>validateSlackAssistantSettingsView(await apiClient.request<unknown>(path(id),{signal,cache:'no-store'})),
 update:async(id:string,expectedVersion:string,config:SlackAssistantConfig)=>{
  validateSlackAssistantVersion(expectedVersion);const valid=validateSlackAssistantConfig(config);
  return validateSlackAssistantSettingsView(await apiClient.request<unknown>(path(id),{method:'PUT',body:JSON.stringify({expectedVersion,config:valid}),signal:AbortSignal.timeout(15000)}));
 },
 follow:(id:string,channelId:string,threadTs:string,follow:boolean)=>apiClient.request<{success:true}>(path(id)+'/followed-threads',{method:'PUT',body:JSON.stringify({channelId,threadTs,follow}),signal:AbortSignal.timeout(15000)}),
};
