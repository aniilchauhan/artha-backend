import {NextResponse} from 'next/server';
import {readSnapshot,snapshotMetadata} from '../../../lib/backend-snapshots';
import type {WholeMarketForecast} from '../../../lib/whole-market-forecast';
export const dynamic='force-dynamic';
export async function GET(){
 try{const snapshot=await readSnapshot<WholeMarketForecast>('whole-market');return NextResponse.json({success:true,data:snapshot.data,snapshot:await snapshotMetadata(snapshot)},{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({success:false,error:'No published market forecast. The backend worker must complete an update.'},{status:503});}
}
