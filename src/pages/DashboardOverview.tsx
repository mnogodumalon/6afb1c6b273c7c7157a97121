import { useMemo, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { IconPlus, IconUsers, IconCheck, IconMapPin, IconCalendarEvent, IconTrophy } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { flowActionFor, countOf } from '@/config/plan';
import { extractRecordId } from '@/services/livingAppsService';
import { lookupKey } from '@/lib/formatters';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { useClock, gruss } from '@/lib/polish';
import { submissionsOf } from '@/lib/journey';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { RecordDoorLink } from '@/components/widgets/RecordDoorLink';
import { Button } from '@/components/ui/button';

type Filter = 'all' | 'open' | 'nofinal';

// widget-rejection: no widget covers a poll card (title + per-date yes/maybe tally + share link);
// Kanban would only show status, Calendar would split one poll's dates across days.
export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { antworten, terminvorschlaege } = data;
  const crud = useEntityCrud(data);
  const polls = crud.enriched.umfragen;
  const clock = useClock();
  const [filter, setFilter] = useState<Filter>('all');

  const fmt = (iso: string | null | undefined, pattern: string) => {
    if (!iso) return '—';
    const d = parseISO(iso);
    return isValid(d) ? format(d, pattern, { locale: dateFnsLocale() }) : '—';
  };

  const rows = useMemo(() => polls.map(u => {
    const terms = terminvorschlaege
      .filter(t => extractRecordId(t.fields.umfrage) === u.record_id)
      .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''));
    const ans = antworten.filter(a => extractRecordId(a.fields.umfrage) === u.record_id);
    const tally = terms.map(t => {
      const own = ans.filter(a => extractRecordId(a.fields.terminvorschlag) === t.record_id);
      return {
        term: t,
        ja: own.filter(a => lookupKey(a.fields.antwort) === 'ja').length,
        vielleicht: own.filter(a => lookupKey(a.fields.antwort) === 'vielleicht').length,
      };
    });
    const maxJa = Math.max(0, ...tally.map(x => x.ja));
    const count = submissionsOf(ans, { names: ['teilnehmer_vorname', 'teilnehmer_nachname'] }).length;
    const isOpen = lookupKey(u.fields.status) !== 'geschlossen';
    const hasFinal = !!u.fields.finaler_termin;
    return { u, tally, maxJa, count, isOpen, hasFinal };
  }), [polls, terminvorschlaege, antworten]);

  const openRows = rows.filter(r => r.isOpen);
  const noFinal = rows.filter(r => !r.hasFinal);
  const visible = rows.filter(r => filter === 'all' ? true : filter === 'open' ? r.isOpen : !r.hasFinal);

  const today = format(clock, 'yyyy-MM-dd');
  const upcoming = terminvorschlaege
    .filter(t => {
      const p = polls.find(u => u.record_id === extractRecordId(t.fields.umfrage));
      return p && lookupKey(p.fields.status) !== 'geschlossen' && (t.fields.beginn ?? '').slice(0, 10) >= today;
    })
    .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''));

  const names = openRows.slice(0, 2).map(r => r.u.fields.titel ?? '').filter(Boolean).join(' & ');
  const context = polls.length === 0
    ? tx('Lege deine erste Umfrage an und teile den Link.')
    : openRows.length === 0
      ? tx('Alle Umfragen sind geschlossen.')
      : tx`Offen: ${names} — ${countOf('umfragen', openRows.length, appLabel('umfragen'))} warten auf Antworten.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground">{context}</p>
        </div>
        {crud.umfragen.canWrite && (
          <Button className="w-full sm:w-auto h-11" onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>
            <IconPlus size={16} className="shrink-0" /> {tx('Neue Umfrage')}
          </Button>
        )}
      </div>

      <DashboardGrid
        variant="wide"
        kpis={polls.length > 0 && (
          <StatStrip>
            <StatStripItem
              title={tx('Offene Umfragen')} value={openRows.length}
              icon={<IconUsers size={16} />}
              onClick={() => setFilter(f => f === 'open' ? 'all' : 'open')} active={filter === 'open'}
            />
            <StatStripItem
              title={tx('Ohne finalen Termin')} value={noFinal.length}
              tone={noFinal.length > 0 ? 'warning' : 'default'}
              icon={<IconCalendarEvent size={16} />}
              onClick={() => setFilter(f => f === 'nofinal' ? 'all' : 'nofinal')} active={filter === 'nofinal'}
            />
          </StatStrip>
        )}
        primary={
          <div className="space-y-4">
            {visible.length === 0 && (
              <div className="rounded-xl border bg-card p-8 text-center space-y-3">
                <IconCalendarEvent size={48} className="mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {polls.length === 0 ? tx('Noch keine Umfrage — starte mit deinem ersten Terminvorschlag.') : tx('Keine Umfrage in dieser Ansicht.')}
                </p>
                {polls.length === 0 && crud.umfragen.canWrite && (
                  <Button className="h-11" onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>{tx('Erste Umfrage anlegen')}</Button>
                )}
              </div>
            )}
            {visible.map(({ u, tally, maxJa, count, isOpen }) => (
              <div key={u.record_id} className="rounded-xl border bg-card p-4 space-y-3 overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" className="min-w-0 text-left" onClick={() => crud.umfragen.openDetail(u)}>
                    <div className="font-semibold truncate">{u.fields.titel}</div>
                    {u.fields.ort && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <IconMapPin size={12} className="shrink-0" />{u.fields.ort}
                      </div>
                    )}
                  </button>
                  <div className="text-xs text-right">
                    <div className={isOpen ? 'font-medium text-emerald-600' : 'font-medium text-muted-foreground'}>
                      {isOpen ? tx('Offen') : tx('Geschlossen')}
                    </div>
                    <div className="text-muted-foreground">{countOf('antworten', count, appLabel('antworten'))}</div>
                  </div>
                </div>

                {!isOpen && u.finaler_terminName && (
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <IconCheck size={16} className="shrink-0 text-emerald-600" />
                    <span className="truncate">{tx`Finaler Termin: ${u.finaler_terminName}`}</span>
                  </div>
                )}

                <div className="space-y-2">
                  {tally.length === 0 && <p className="text-sm text-muted-foreground">{tx('Noch keine Terminvorschläge.')}</p>}
                  {tally.map(({ term, ja, vielleicht }) => {
                    const best = maxJa > 0 && ja === maxJa;
                    const isFinal = extractRecordId(u.fields.finaler_termin) === term.record_id;
                    const go = isOpen ? flowActionFor('umfragen', 'finaler_termin', u.record_id, term.record_id) : null;
                    return (
                      <div
                        key={term.record_id}
                        className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${best ? 'border-emerald-500 bg-emerald-500/10' : ''}`}
                      >
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => crud.terminvorschlaege.openDetail(term)}>
                          <div className="text-sm font-medium truncate flex items-center gap-1">
                            {best && <IconTrophy size={14} className="shrink-0 text-emerald-600" />}
                            {fmt(term.fields.beginn, 'EEE dd.MM. HH:mm')}–{fmt(term.fields.ende, 'HH:mm')}
                            {isFinal && <IconCheck size={14} className="shrink-0 text-emerald-600" />}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium text-emerald-600">{tx`${ja} Ja`}</span>
                            {' · '}
                            <span className="font-medium text-amber-600">{tx`${vielleicht} Vielleicht`}</span>
                          </div>
                        </button>
                        {go && (
                          <Button size="sm" variant={best ? 'default' : 'outline'} className="h-10 w-full sm:w-auto" onClick={go}>
                            {tx('Final festlegen & schließen')}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <RecordDoorLink page="termin-abstimmen" recordId={u.record_id} qr />
              </div>
            ))}
          </div>
        }
        aside={
          <WorkList
            title={tx('Nächste Terminvorschläge')}
            items={upcoming.map(t => ({
              id: t.record_id,
              title: polls.find(u => u.record_id === extractRecordId(t.fields.umfrage))?.fields.titel ?? '',
              secondLine: <span className="text-muted-foreground">{fmt(t.fields.beginn, 'EEE dd.MM. HH:mm')}</span>,
            }))}
            onItemClick={id => {
              const t = terminvorschlaege.find(x => x.record_id === id);
              if (t) crud.terminvorschlaege.openDetail(t);
            }}
            empty={{ text: tx('Keine anstehenden Terminvorschläge in offenen Umfragen.') }}
          />
        }
      />
      {crud.surfaces}
    </div>
  );
}
