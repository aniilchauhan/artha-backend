import {NextRequest,NextResponse} from 'next/server';
import {parseResearchSelection,readResearchBacktest} from '../../../lib/backtest-research-store';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:NextRequest){
  try{parseResearchSelection(req.nextUrl.searchParams);}catch{return NextResponse.json({error:'Choose a supported amount, strategy, holding period, exit and portfolio size.'},{status:400});}
  try{return NextResponse.json(await readResearchBacktest(req.nextUrl.searchParams),{headers:{'Cache-Control':'private, max-age=60'}});}
  catch{return NextResponse.json({error:'The verified backtest dataset is not ready or cannot be read. No substitute results are shown.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
