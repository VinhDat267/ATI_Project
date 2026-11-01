import {validateSlackPostPlan} from '@wap/tool-schemas';
import {hasSlackMarker} from './slack-message-selectors.js';
import {isBoundSlackReadPlan} from './slack-read-plan.js';
export function isBoundSlackWritePlan(value:any,owner:string):boolean{
 try{validateSlackPostPlan(value,owner);const {connections:_,...body}=value;return !hasSlackMarker(body);}catch{return false;}
}
export function isBoundSlackManualPlan(value:any,owner:string):boolean{return isBoundSlackReadPlan(value,owner)||isBoundSlackWritePlan(value,owner);}
