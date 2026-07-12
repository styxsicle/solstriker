/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma include result shapes are normalized at this API boundary. */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { MAX_WALLETS_PER_RECONSTRUCTION, reconstructWallets, releaseReconstructionLock, tryAcquireReconstructionLock } from '../services/walletPositions/reconstructWallets.js';

const bodySchema = z.object({ walletIds: z.array(z.string().min(1)).min(1).max(MAX_WALLETS_PER_RECONSTRUCTION), includeDev: z.boolean().default(false) });
const querySchema = z.object({ walletId:z.string().optional(), tokenId:z.string().optional(), status:z.string().optional(), confidence:z.string().optional(), page:z.coerce.number().int().min(1).default(1), pageSize:z.coerce.number().int().min(1).max(100).default(25) });
const json = (s:string) => { try { return JSON.parse(s) as unknown; } catch { return []; } };
function positionDto(p: any) {
  return { ...p, openedAt:p.openedAt?.toISOString()??null, closedAt:p.closedAt?.toISOString()??null,
    lastEventAt:p.lastEventAt?.toISOString()??null, valuationObservedAt:p.valuationObservedAt?.toISOString()??null,
    calculatedAt:p.calculatedAt.toISOString(), createdAt:p.createdAt.toISOString(), updatedAt:p.updatedAt.toISOString(),
    warningCodes:json(p.warningCodes), includedEventIds:json(p.includedEventIdsJson), exclusionReasons:json(p.exclusionReasonsJson),
    decoderVersions:json(p.decoderVersionsJson), includedEventIdsJson:undefined, exclusionReasonsJson:undefined, decoderVersionsJson:undefined,
    matches:p.matches?.map((m:any)=>({...m,warningCodes:json(m.warningCodes),createdAt:m.createdAt.toISOString(),updatedAt:m.updatedAt.toISOString()})), };
}
function profileDto(p:any) { return {...p, warningCodes:json(p.warningCodes), calculatedAt:p.calculatedAt.toISOString(), createdAt:p.createdAt.toISOString(),updatedAt:p.updatedAt.toISOString()}; }
async function knownBuySizes(prisma:PrismaClient,walletId:string){const events=await prisma.walletEvent.findMany({where:{walletId,eventType:'BUY',decoderVersion:{gte:2},confidence:{in:['CONFIRMED','LIKELY']},quoteMint:{in:['SOL','So11111111111111111111111111111111111111112']},quoteAmount:{not:null}},select:{quoteAmount:true},orderBy:[{blockTime:'asc'},{id:'asc'}]});return events.flatMap(e=>e.quoteAmount&&e.quoteAmount>0?[e.quoteAmount.toString()]:[]);}

export function registerWalletPositionRoutes(app:FastifyInstance, prisma:PrismaClient, nodeEnv:string) {
  app.post('/api/wallet-positions/reconstruct', async (request,reply)=>{
    const parsed=bodySchema.safeParse(request.body); if(!parsed.success) return reply.code(400).send({error:'validation_error',issues:parsed.error.issues});
    if(new Set(parsed.data.walletIds).size!==parsed.data.walletIds.length) return reply.code(400).send({error:'duplicate_selection'});
    if(parsed.data.includeDev && nodeEnv==='production') return reply.code(403).send({error:'include_dev_disabled_in_production'});
    const wallets=await prisma.trackedWallet.findMany({where:{id:{in:parsed.data.walletIds}}});
    if(wallets.length!==parsed.data.walletIds.length) return reply.code(400).send({error:'unknown_wallet'});
    const dev=wallets.filter(w=>w.source==='dev-seed'); if(dev.length&&!parsed.data.includeDev) return reply.code(400).send({error:'dev_wallet_excluded'});
    if(!tryAcquireReconstructionLock()) return reply.code(409).send({error:'reconstruction_in_progress'});
    try { return await reconstructWallets(prisma,wallets); } finally { releaseReconstructionLock(); }
  });
  app.get('/api/wallet-positions',async(request,reply)=>{
    const q=querySchema.safeParse(request.query); if(!q.success)return reply.code(400).send({error:'validation_error'});
    const {page,pageSize,walletId,tokenId,status,confidence}=q.data; const where={...(walletId?{trackedWalletId:walletId}:{}),...(tokenId?{tokenId}:{}),...(status?{status}:{}),...(confidence?{confidence}:{})};
    const [items,total]=await Promise.all([prisma.walletPosition.findMany({where,include:{token:{select:{mintAddress:true,name:true,symbol:true}},trackedWallet:{select:{address:true,label:true,emoji:true}},matches:true},orderBy:[{openedAt:'desc'},{id:'asc'}],skip:(page-1)*pageSize,take:pageSize}),prisma.walletPosition.count({where})]);
    return {items:items.map(positionDto),page,pageSize,total};
  });
  app.get('/api/wallet-positions/:walletId/:positionId',async(request,reply)=>{const {walletId,positionId}=request.params as any;const p=await prisma.walletPosition.findFirst({where:{id:positionId,trackedWalletId:walletId},include:{token:true,trackedWallet:true,matches:true}});if(!p)return reply.code(404).send({error:'position_not_found'});return positionDto(p);});
  app.get('/api/wallet-positions/:walletId',async(request,reply)=>{const {walletId}=request.params as any;const q=querySchema.safeParse(request.query);if(!q.success)return reply.code(400).send({error:'validation_error'});const wallet=await prisma.trackedWallet.findUnique({where:{id:walletId}});if(!wallet)return reply.code(404).send({error:'wallet_not_found'});const where={trackedWalletId:walletId,...(q.data.status?{status:q.data.status}:{}),...(q.data.confidence?{confidence:q.data.confidence}:{}),...(q.data.tokenId?{tokenId:q.data.tokenId}:{})};const [items,total]=await Promise.all([prisma.walletPosition.findMany({where,include:{token:true,matches:true},orderBy:[{openedAt:'desc'},{id:'asc'}],skip:(q.data.page-1)*q.data.pageSize,take:q.data.pageSize}),prisma.walletPosition.count({where})]);return{wallet:{id:wallet.id,address:wallet.address,label:wallet.label,emoji:wallet.emoji},items:items.map(positionDto),page:q.data.page,pageSize:q.data.pageSize,total};});
  app.get('/api/wallet-profiles',async(request)=>{const q=querySchema.parse(request.query);const profiles=await prisma.walletBehaviorProfile.findMany({where:q.walletId?{trackedWalletId:q.walletId}:{},include:{trackedWallet:{select:{address:true,label:true,emoji:true}},reconstructionRun:{select:{method:true,status:true}}},orderBy:[{calculatedAt:'desc'},{trackedWalletId:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize});return{items:await Promise.all(profiles.map(async p=>({...profileDto(p),knownBuySizesSol:await knownBuySizes(prisma,p.trackedWalletId)}))),page:q.page,pageSize:q.pageSize};});
  app.get('/api/wallet-profiles/:walletId',async(request,reply)=>{const {walletId}=request.params as any;const p=await prisma.walletBehaviorProfile.findFirst({where:{trackedWalletId:walletId},include:{trackedWallet:true,reconstructionRun:true},orderBy:{calculatedAt:'desc'}});if(!p)return reply.code(404).send({error:'profile_not_found'});return{...profileDto(p),knownBuySizesSol:await knownBuySizes(prisma,walletId)};});
  app.get('/api/wallet-position-runs/:id',async(request,reply)=>{const {id}=request.params as any;const r=await prisma.walletPositionReconstructionRun.findUnique({where:{id}});if(!r)return reply.code(404).send({error:'run_not_found'});return{...r,startedAt:r.startedAt.toISOString(),completedAt:r.completedAt?.toISOString()??null,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString()};});
}
