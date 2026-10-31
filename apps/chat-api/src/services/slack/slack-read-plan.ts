import {isSlackReadTool,validateSlackPlanBindings} from '@wap/tool-schemas';
import {hasSlackMarker} from './slack-message-selectors.js';
/** Only approved binding metadata is excluded; source markers anywhere else retain normal lineage requirements. */
export function isBoundSlackReadPlan(value:any,owner:string):boolean{
 try{
  if(value?.kind!=='plan'||!Array.isArray(value.steps)||!value.steps.length||value.steps.some((s:any)=>!isSlackReadTool(s.tool))||
     !value.connections||Object.keys(value.connections).some(k=>k!=='myslack'))return false;
  const bindings=validateSlackPlanBindings(value.connections.myslack,value.steps);
  if(Object.values(bindings.bindings).some(b=>b.atiUserId!==owner))return false;
  const {connections:_,...body}=value;return !hasSlackMarker(body);
 }catch{return false;}
}
