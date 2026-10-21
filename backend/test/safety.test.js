import test from 'node:test';
import assert from 'node:assert/strict';
import { guardGeneratedClaims, matchingSkills, filterJob } from '../src/ai.js';
import { DEFAULT_PREFERENCES } from '../src/config.js';
import { localDate } from '../src/util.js';
test('AI personal claims are checked in every generated field, including questions and team claims',()=>{
  const p={...DEFAULT_PREFERENCES};
  for(const claim of ['My team has delivered 100 successful projects.','Would you like to see my previous clients?','I am certified in your platform.','We have 10 years of experience.','Award-winning developer with proven track record.']) {
    assert.throws(()=>guardGeneratedClaims(['Propose a technical plan.',claim],p),{code:'UNSUPPORTED_CLAIM'});
  }
  assert.doesNotThrow(()=>guardGeneratedClaims(['I would review your existing WordPress configuration.','Which pages should be prioritized?'],p));
  const verified='I have completed the WordPress project documented in my portfolio.';
  assert.doesNotThrow(()=>guardGeneratedClaims([verified,'I would propose a short discovery call.'],{...p,verified_profile:verified}));
});
test('short skill words require word boundaries and accept configured service aliases',()=>{
  assert.deepEqual(matchingSkills({title:'Wholesale data service',description:'Detailed specification',skills:[]},{skills:['SQL']}),[]);
  assert.deepEqual(matchingSkills({title:'React and Elementor build',description:'',skills:[]},{skills:['React.js','WordPress']}),['React.js','WordPress']);
});
test('hourly and fixed thresholds are distinct and a currency change is not treated as a conversion',()=>{
  const base={kind:'job',full_description:true,work_type:'hourly',experience_level:'intermediate',budget_min:20,budget_max:30,currency:'USD',posted_at:null};
  assert.equal(filterJob(base,DEFAULT_PREFERENCES).eligible,true);
  assert.equal(filterJob({...base,work_type:'fixed'},DEFAULT_PREFERENCES).eligible,false);
  assert.equal(filterJob({...base,currency:'INR'},DEFAULT_PREFERENCES).eligible,false);
});
test('daily accounting rolls over at midnight in India rather than UTC',()=>{
  assert.equal(localDate(new Date('2026-10-20T18:29:59Z')),'2026-10-20');
  assert.equal(localDate(new Date('2026-10-20T18:30:00Z')),'2026-10-21');
});
