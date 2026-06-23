import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { flowRecordsTable } from "@workspace/db";

export interface FlowFilterInput {
  srcIp?: string;
  dstIp?: string;
  srcNatIp?: string;
  dstNatIp?: string;
  nasId?: number;
  dateFrom?: string;
  dateTo?: string;
  startTime?: string;
  endTime?: string;
}

export function buildFlowFilters(input: FlowFilterInput): SQL | undefined {
  const conditions: SQL[] = [];

  if (input.srcIp) conditions.push(eq(flowRecordsTable.srcIp, input.srcIp));
  if (input.dstIp) conditions.push(eq(flowRecordsTable.dstIp, input.dstIp));
  if (input.srcNatIp)
    conditions.push(eq(flowRecordsTable.srcNatIp, input.srcNatIp));
  if (input.dstNatIp)
    conditions.push(eq(flowRecordsTable.dstNatIp, input.dstNatIp));
  if (input.nasId !== undefined)
    conditions.push(eq(flowRecordsTable.nasId, input.nasId));
  if (input.dateFrom)
    conditions.push(gte(flowRecordsTable.flowDate, input.dateFrom));
  if (input.dateTo)
    conditions.push(lte(flowRecordsTable.flowDate, input.dateTo));
  if (input.startTime)
    conditions.push(
      sql`to_char(${flowRecordsTable.startTime}, 'HH24:MI') >= ${input.startTime}`,
    );
  if (input.endTime)
    conditions.push(
      sql`to_char(${flowRecordsTable.endTime}, 'HH24:MI') <= ${input.endTime}`,
    );

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}
