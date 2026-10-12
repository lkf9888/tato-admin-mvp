import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prisma } from '../lib/prisma';
import { loadReplyContext, replyContextText } from '../lib/guest-reply-prompt';
import { buildKnowledgeBlock, type KnowledgeEntry } from '../lib/message-knowledge';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 20, minute));
const order = { id: 'trip', externalOrderId: 'reservation', vehicleId: 'tesla', renterName: 'Guest', pickupDatetime: at(-100), returnDatetime: at(100), pickupLocation: 'YVR', returnLocation: 'Office', vehicle: { brand: 'Tesla', model: 'Model Y', year: 2020, plateNumber: 'TEST' } };
const email = (id: string, text: string, minute: number) => ({ id, guestText: text, bodyText: text, receivedAt: at(minute), parsed: null, order });

function replace(target: any, key: string, value: (...args: any[]) => any) {
  const original = target[key]; target[key] = value; return () => { target[key] = original; };
}

// Only the external database is replaced; the real loader, retrieval and prompt builder run.
async function withRows(emails: ReturnType<typeof email>[], recorded: { direction: string; body: string; sentAt: Date }[], run: () => Promise<void>) {
  const handles = [
    replace(prisma.inboundEmail, 'findMany', async (args: any) => emails.filter(x => args.where.id.in.includes(x.id)).sort((a,b) => +b.receivedAt - +a.receivedAt).slice(0,args.take ?? 60)),
    replace(prisma.turoConversationMessage, 'findMany', async (args: any) => typeof args.where.reservationId === 'string' ? recorded : []),
    replace(prisma.assistantMemory, 'findMany', async () => []),
    replace(prisma.vehicleReplyKnowledge, 'findFirst', async () => null),
    replace(prisma.messageTemplate, 'findMany', async () => []),
    replace(prisma.vehicle, 'findMany', async () => []),
  ];
  try { await run(); } finally { handles.forEach(h => h()); }
}

test('a host-only recording cannot hide the preceding parking-ticket question', async () => {
  const emails = [email('first', 'I got a parking ticket. Should I pay it online?', 1), email('last', 'Or does it go through Turo?', 2)];
  await withRows(emails, [{ direction:'outbound',body:'Charging goes to our Tesla account.',sentAt:at(0) }, { direction:'outbound',body:'You can pay it online.',sentAt:at(3) }], async () => {
    const c = await loadReplyContext({ workspaceId:'test',emailIds:emails.map(x=>x.id),guestName:'Guest',vehicleId:'tesla',emailId:'last' });
    assert(c); const prompt = replyContextText(c);
    assert.match(prompt,/I got a parking ticket/);
    assert.match(prompt,/You can pay it online/);
    assert.match(prompt,/Or does it go through Turo/);
    assert(prompt.indexOf('I got a parking ticket') < prompt.indexOf('You can pay it online'));
  });
});

test('the requested message remains the target beyond the five newest emails', async () => {
  const emails = Array.from({length:8},(_,i)=>email('e'+i,'Question '+i,i));
  await withRows(emails, [], async () => {
    const c=await loadReplyContext({workspaceId:'test',emailIds:emails.map(x=>x.id),guestName:'Guest',vehicleId:'tesla',emailId:'e0'});
    assert(c); assert.equal(c.lastGuestText,'Question 0');
    assert.match(replyContextText(c),/Reply to this message specifically:\nQuestion 0/);
  });
});

test('an unprovided target id cannot silently draft for a different question', async () => {
  const emails=[email('e1','Question',1)];
  await withRows(emails, [], async () => {
    assert.equal(await loadReplyContext({workspaceId:'test',emailIds:['e1'],guestName:'Guest',vehicleId:'tesla',emailId:'another'}),null);
  });
});

function entry(id: string, role: string, words: string[]): KnowledgeEntry {
  return { id, label:id, content:id, kind:'fact', triggers:[], vehicleIds:null, stages:null, locations:words, locationRole:role, validUntil:null,aiEnabled:true,updatedAt:at(0).toISOString() } as KnowledgeEntry;
}
const entries=[entry('office pickup','pickup',['Office']),entry('airport pickup','pickup',['YVR']),entry('office return','return',['Office']),entry('airport return','return',['YVR'])];
function selected(pickupLocation: string|null,returnLocation:string|null) {
  return buildKnowledgeBlock({entries,scope:{vehicleId:'car',stage:'during',location:[pickupLocation,returnLocation].filter(Boolean).join(' | '),pickupLocation,returnLocation} as any,question:'Where are the keys?',context:null,vehicleLabels:{}}).used.map(x=>x.id).sort();
}
test('office pickup and airport return never authorize airport pickup or office return',()=>assert.deepEqual(selected('Office','YVR'),['airport return','office pickup']));
test('airport pickup and office return keep the reverse roles separate',()=>assert.deepEqual(selected('YVR','Office'),['airport pickup','office return']));
test('an unknown pickup cannot borrow the return address',()=>assert.deepEqual(selected(null,'YVR'),['airport return']));
test('an unknown return cannot borrow the pickup address',()=>assert.deepEqual(selected('Office',null),['office pickup']));

test('the same guest question from mail and reader appears once, with both speakers retained', async () => {
  const emails=[email('first','Guest has sent you a message about your Tesla.\nIs this a parking ticket?',1),email('last','Or does it go through Turo?',3)];
  await withRows(emails,[{direction:'inbound',body:'Is this a parking ticket?',sentAt:at(0)},{direction:'outbound',body:'You can pay online.',sentAt:at(2)}],async()=>{
    const c=await loadReplyContext({workspaceId:'test',emailIds:emails.map(x=>x.id),guestName:'Guest',vehicleId:'tesla'});
    assert(c); assert.equal(c.transcript.match(/Is this a parking ticket/g)?.length,1);
    assert.match(c.transcript,/Host: You can pay online/);
    assert.equal(c.focus,'Or does it go through Turo?');
  });
});

test('the matched trip vehicle takes precedence over an inconsistent UI vehicle id',async()=>{
  const emails=[email('last','Where is the key?',1)];
  await withRows(emails,[],async()=>{
    const lookups: (string|null)[]=[];
    const restore=replace(prisma.vehicleReplyKnowledge,'findFirst',async(args:any)=>{lookups.push(args.where.vehicleId);return null;});
    try {
      const c=await loadReplyContext({workspaceId:'test',emailIds:['last'],guestName:'Guest',vehicleId:'different-car'});
      assert(c);assert.match(c.facts,/Tesla Model Y/);assert.deepEqual(lookups,['tesla']);
    } finally {restore();}
  });
});

test('a legacy location entry is withheld until both addresses match',()=>{
  const legacy=entry('legacy','pickup',['YVR']);delete legacy.locationRole;
  const block=(pickupLocation:string|null,returnLocation:string|null)=>buildKnowledgeBlock({entries:[legacy],scope:{vehicleId:null,stage:null,pickupLocation,returnLocation},question:'',context:null,vehicleLabels:{}}).used.length;
  assert.equal(block('Office','YVR'),0);assert.equal(block(null,'YVR'),0);assert.equal(block('YVR','YVR'),1);
});

test('vehicle restrictions and expiration still exclude ineligible knowledge',()=>{
  const scoped={...entry('lexus','pickup',['Office']),vehicleIds:['lexus']};
  const expired={...entry('expired','pickup',['Office']),validUntil:'2020-01-01'};
  const block=(vehicleId:string|null)=>buildKnowledgeBlock({entries:[scoped,expired],scope:{vehicleId,stage:'during',pickupLocation:'Office',returnLocation:'YVR'},question:'USB',context:null,vehicleLabels:{}}).used.map(x=>x.id);
  assert.deepEqual(block('tesla'),[]);assert.deepEqual(block(null),[]);assert.deepEqual(block('lexus'),['lexus']);
});
