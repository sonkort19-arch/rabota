"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const workflow=name=>fs.readFileSync(path.join(root,".github","workflows",name),"utf8");
const handoff=workflow("crm-qa-handoff.yml");
const inline=handoff.split("          script: |\n")[1].split("\n").map(line=>line.slice(12)).join("\n");
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const runHandoff=new AsyncFunction("github","context","process",inline);
const context={repo:{owner:"owner",repo:"test-crm"},issue:{number:67},actor:"pusher",
  serverUrl:"https://github.com",eventName:"pull_request_target"};

function fakeGitHub(){
  const pr={state:"open",number:67,head:{sha:"1".repeat(40)},user:{login:"author"},
    base:{ref:"main"},
    draft:false,requested_reviewers:[{login:"Requested"}],html_url:"https://github.com/owner/test-crm/pull/67"};
  const comments=[];
  const requests=[];
  const reviews=[];
  const statuses=[];
  const github={
    paginate:(method,params)=>method(params),
    rest:{
      pulls:{
        get:async()=>({data:pr}),
        listReviews:async()=>reviews,
        requestReviewers:async request=>requests.push(request)
      },
      issues:{
        listComments:async()=>comments,
        createComment:async data=>comments.push({id:comments.length+1,body:data.body,user:{login:"github-actions[bot]"}}),
        updateComment:async data=>{comments.find(comment=>comment.id===data.comment_id).body=data.body;}
      },
      repos:{
        listPullRequestsAssociatedWithCommit:async()=>[{number:pr.number}],
        createCommitStatus:async data=>statuses.push(data)
      }
    }
  };
  return {github,pr,comments,requests,reviews,statuses};
}

test("handoff posts one exact-head brief and refreshes it after another push",async()=>{
  const {github,pr,comments,requests}=fakeGitHub();
  const process={env:{
    CRM_QA_URL:"https://rabota-qa.vercel.app/",
    CRM_QA_REVIEWERS:"Author, Pusher, Requested, QA-user, qa-user, invalid/login"
  }};
  await runHandoff(github,context,process);
  assert.equal(comments.length,1);
  assert.match(comments[0].body,/https:\/\/rabota-qa\.vercel\.app\/qa-build\.json/);
  assert.match(comments[0].body,/https:\/\/github\.com\/owner\/test-crm\/pull\/67\/checks/);
  assert.match(comments[0].body,/issues\/new\?template=qa-report\.yml/);
  assert.match(comments[0].body,new RegExp(pr.head.sha));
  assert.deepEqual(requests[0].reviewers,["qa-user"]);
  pr.head.sha="a".repeat(40);
  await runHandoff(github,context,process);
  assert.equal(comments.length,1);
  assert.match(comments[0].body,new RegExp(pr.head.sha));
  assert.doesNotMatch(comments[0].body,/1{40}/);
});

test("drafts do not request a review and Vercel URLs outside the QA naming pattern are omitted",async()=>{
  const {github,pr,comments,requests}=fakeGitHub();
  pr.draft=true;
  await runHandoff(github,context,{env:{
    CRM_QA_URL:"https://rabota-sonkort19-6069s-projects.vercel.app",
    CRM_QA_REVIEWERS:"tester"
  }});
  assert.equal(comments.length,1);
  assert.match(comments[0].body,/Черновик/);
  assert.doesNotMatch(comments[0].body,/rabota-sonkort19-6069s-projects\.vercel\.app/);
  assert.deepEqual(requests,[]);
});

test("independent approval demands the current SHA and a named tester",async()=>{
  const {github,pr,reviews,statuses}=fakeGitHub();
  const process={env:{CRM_QA_REVIEWERS:"Author,qa1,qa2"}};
  function review(id,login,state,sha=pr.head.sha){
    reviews.push({id,user:{login},commit_id:sha,state,html_url:pr.html_url+"#pullrequestreview-"+id});
  }
  review(1,"author","APPROVED");
  review(2,"stranger","APPROVED");
  review(3,"qa1","APPROVED","9".repeat(40));
  await runHandoff(github,context,process);
  assert.equal(statuses.at(-1).state,"pending");
  review(4,"QA1","APPROVED");
  await runHandoff(github,context,process);
  assert.equal(statuses.at(-1).state,"success");
  assert.equal(statuses.at(-1).sha,pr.head.sha);
  assert.equal(statuses.at(-1).context,"Independent QA");
  review(5,"qa2","CHANGES_REQUESTED");
  review(6,"qa2","COMMENTED");
  await runHandoff(github,context,process);
  assert.equal(statuses.at(-1).state,"failure");
  review(7,"qa2","APPROVED");
  await runHandoff(github,context,process);
  assert.equal(statuses.at(-1).state,"success");
  reviews.find(row=>row.id===4).state="DISMISSED";
  reviews.find(row=>row.id===7).state="DISMISSED";
  await runHandoff(github,context,process);
  assert.equal(statuses.at(-1).state,"pending");
  pr.head.sha="a".repeat(40);
  await runHandoff(github,context,process);
  assert.equal(statuses.at(-1).state,"pending");
  assert.equal(statuses.at(-1).sha,pr.head.sha);
});

test("a review signal reads live PR data and updates only the named check",async()=>{
  const {github,pr,reviews,statuses,comments,requests}=fakeGitHub();
  reviews.push({id:1,user:{login:"tester"},commit_id:pr.head.sha,state:"APPROVED"});
  const event={...context,eventName:"workflow_run",payload:{workflow_run:{
    event:"pull_request_review",head_sha:pr.head.sha,pull_requests:[]
  }}};
  await runHandoff(github,event,{env:{CRM_QA_REVIEWERS:"tester"}});
  assert.equal(statuses[0].state,"success");
  assert.deepEqual(comments,[]);
  assert.deepEqual(requests,[]);
  event.payload.workflow_run.event="workflow_dispatch";
  await runHandoff(github,event,{env:{CRM_QA_REVIEWERS:"tester"}});
  pr.base.ref="infra/isolated-qa";
  event.payload.workflow_run.event="pull_request_review";
  await runHandoff(github,event,{env:{CRM_QA_REVIEWERS:"tester"}});
  assert.equal(statuses.length,1);
});

test("release check requires every isolated job and the write-enabled handoff reads no candidate files",()=>{
  const checks=workflow("crm-checks.yml");
  assert.match(checks,/pull_request:\s+branches: \[main\]/);
  assert.match(checks,/needs: \[javascript, browser, postgres\]/);
  assert.match(checks,/JAVASCRIPT" == success && "\$BROWSERS" == success && "\$POSTGRES" == success/);
  assert.equal((checks.match(/--network none/g)||[]).length,3);
  assert.match(handoff,/pull_request_target:\s+branches: \[main\]/);
  assert.doesNotMatch(handoff,/actions\/checkout|secrets\.|\beval\(/);
  const signal=workflow("crm-review-signal.yml");
  assert.match(signal,/pull_request_review:[\s\S]+permissions: \{\}/);
  assert.doesNotMatch(signal,/(?:upload|download)-artifact|actions\/checkout|secrets\./);
});
