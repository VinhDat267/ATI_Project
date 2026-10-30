import {describe,expect,it} from 'vitest';
import {slackIngressEnv} from '../../src/config/slack-ingress-env.js';

describe('Slack lifecycle ingress configuration',()=>{
  it('keeps configured lifecycle ingress available with both content flags off',()=>{
    expect(slackIngressEnv({MYSLACK_ENABLED:'off',MYSLACK_AUTOMATION_ENABLED:'off',SLACK_SIGNING_SECRET:'fixture-signing-secret',MYSLACK_APP_ID:'A_FIXTURE'},true))
      .toEqual({signingSecret:'fixture-signing-secret',appId:'A_FIXTURE',automationEnabled:false});
  });

  it('never enables ordinary automation when the content feature is off',()=>{
    expect(slackIngressEnv({MYSLACK_ENABLED:'off',MYSLACK_AUTOMATION_ENABLED:'on',SLACK_SIGNING_SECRET:'fixture-signing-secret',MYSLACK_APP_ID:'A_FIXTURE'},true)?.automationEnabled).toBe(false);
  });

  it('leaves an unconfigured disabled deployment fail closed',()=>{
    expect(slackIngressEnv({},true)).toBeUndefined();
  });

  it('refuses a partially configured lifecycle endpoint in live mode',()=>{
    expect(()=>slackIngressEnv({MYSLACK_ENABLED:'off',SLACK_SIGNING_SECRET:'fixture-signing-secret'},true)).toThrow('MYSLACK_APP_ID');
  });
});
