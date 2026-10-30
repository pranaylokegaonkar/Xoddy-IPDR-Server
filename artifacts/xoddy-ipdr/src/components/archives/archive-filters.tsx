import {
  getGetArchiveCoverageQueryKey,
  getGetArchiveNasOptionsQueryKey,
  useGetArchiveCoverage,
  useGetArchiveNasOptions,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";

interface ArchiveFiltersProps {
  startDate: string;
  endDate: string;
  nasId: string;
  appliedNasId: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onNasIdChange: (value: string) => void;
  isFetching: boolean;
  invalidDateRange: boolean;
  onShowData: () => void;
  hasPendingFilters: boolean;
}

const istFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function ArchiveFilters({
  startDate, endDate, nasId, appliedNasId, onStartDateChange, onEndDateChange,
  onNasIdChange, isFetching, invalidDateRange, onShowData, hasPendingFilters,
}: ArchiveFiltersProps) {
  const coverageParams = appliedNasId === "all" ? undefined : { nasId: Number(appliedNasId) };
  const { data: coverage, isLoading: isCoverageLoading, isError: isCoverageError } =
    useGetArchiveCoverage(coverageParams, {
      query: {
        queryKey: getGetArchiveCoverageQueryKey(coverageParams),
        staleTime: 15000,
        refetchInterval: 30000,
      },
    });
  const {
    data: nasOptions, isLoading: isNasLoading, isError: isNasError, refetch: refetchNas,
  } = useGetArchiveNasOptions({
    query: {
      queryKey: getGetArchiveNasOptionsQueryKey(),
      staleTime: 30000,
      refetchInterval: 60000,
    },
  });

  return (
    <Card className="shadow-sm border-border">
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => { event.preventDefault(); onShowData(); }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="archive-start-date">Start date</Label>
            <Input
              id="archive-start-date"
              data-testid="input-archive-start-date"
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="w-full sm:w-48"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="archive-end-date">End date</Label>
            <Input
              id="archive-end-date"
              data-testid="input-archive-end-date"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => onEndDateChange(event.target.value)}
              className="w-full sm:w-48"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="archive-nas">NAS</Label>
            <Select value={nasId} onValueChange={onNasIdChange} disabled={isNasLoading}>
              <SelectTrigger id="archive-nas" data-testid="select-archive-nas" className="w-60">
                <SelectValue placeholder={isNasLoading ? "Loading NAS devices…" : "All NAS devices"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All NAS devices</SelectItem>
                {nasOptions?.map((nas) => (
                  <SelectItem key={nas.id} value={String(nas.id)}>
                    {nas.name}{nas.ipAddress ? ` (${nas.ipAddress})` : ""}
                  </SelectItem>
                ))}
                {nasId !== "all" && !nasOptions?.some((nas) => String(nas.id) === nasId) && (
                  <SelectItem value={nasId}>NAS {nasId}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            data-testid="button-show-archive-data"
            disabled={invalidDateRange || isFetching}
          >
            {isFetching
              ? <Loader2 className="size-4 mr-2 animate-spin" />
              : <Search className="size-4 mr-2" />}
            {isFetching ? "Loading…" : "Show Data"}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="button-clear-archive-dates"
            onClick={() => { onStartDateChange(""); onEndDateChange(""); }}
            disabled={!startDate && !endDate}
          >
            Clear dates
          </Button>
          <span className="text-xs text-muted-foreground">Filters archive-window dates in IST.</span>
          {hasPendingFilters && (
            <span className="basis-full text-xs text-muted-foreground" role="status">
              Filters changed. Click Show Data to apply.
            </span>
          )}
          {isNasError && (
            <div className="flex items-center gap-2 text-xs text-destructive" role="alert">
              Unable to load NAS devices.
              <Button type="button" variant="outline" size="sm" onClick={() => void refetchNas()}>
                Retry NAS
              </Button>
            </div>
          )}
          {isFetching && (
            <span className="text-xs text-muted-foreground" role="status">Updating archives…</span>
          )}
          {invalidDateRange && (
            <span className="text-xs text-destructive" role="alert">
              End date must be on or after the start date.
            </span>
          )}
        </form>
        <div
          className="order-first self-end text-right lg:order-last lg:self-start lg:shrink-0"
          title="Latest archive period end for the applied NAS filter, regardless of date filters; not the Archived At timestamp. This does not imply uninterrupted coverage."
        >
          <p className="text-xs text-muted-foreground">Data available till</p>
          <p
            className="mt-1 text-sm font-semibold tabular-nums"
            data-testid="text-archive-data-available-till"
            aria-live="polite"
          >
            {isCoverageLoading
              ? "Loading…"
              : isCoverageError
                ? "Unable to load"
                : coverage?.latestPeriodEnd
                  ? `${istFormatter.format(new Date(coverage.latestPeriodEnd))} IST`
                  : "No archived data"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
