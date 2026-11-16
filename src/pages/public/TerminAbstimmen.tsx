import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PublicShell } from '@/components/PublicShell';
import { Button } from '@/components/ui/button';
import { Bound } from '@/components/blocks/Bound';
import { LoadProblem } from '@/components/blocks/LoadProblem';
import {
  loadPublicPagesConfig,
  getPublicRecord,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort, hydrateLookups } from '@/lib/journey/publicPort';
import {
  useLiveList,
  useStepForm,
  useJourneySubmit,
  submissionsOf,
  topOne,
  fieldText,
  fieldDate,
  fieldRef,
  fieldLookup,
  type JourneyPort,
  type JourneyRecord,
  type PlanStep,
} from '@/lib/journey';
import { tx } from '@/i18n';

const SLUG = 'termin-abstimmen';
// umfrage is NOT sent by the page: the record's write door presets it on every create

type Vote = 'ja' | 'vielleicht' | 'nein';

const VOTE_STYLE: Record<Vote, { on: string; text: string }> = {
  ja: { on: 'bg-emerald-600 text-white border-emerald-600', text: 'text-emerald-700' },
  vielleicht: { on: 'bg-amber-500 text-white border-amber-500', text: 'text-amber-700' },
  nein: { on: 'bg-rose-600 text-white border-rose-600', text: 'text-rose-700' },
};

export default function TerminAbstimmen() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      setCfg(c);
      setPage(c?.pages[SLUG] ?? null);
      setLoading(false);
    });
  }, []);

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }
  return <Poll cfg={cfg} page={page} />;
}

function Poll({ cfg, page }: { cfg: PublicPagesConfig; page: PublicPageConfig }) {
  const [params] = useSearchParams();
  const linkedId = params.get('umfrage');
  const port = useMemo<JourneyPort>(() => createPublicPort(cfg, page), [cfg, page]);

  // the record's door reads the poll by its exact path only — never the collection of polls
  const [umfrage, setUmfrage] = useState<JourneyRecord | undefined>(undefined);
  const [umfrageState, setUmfrageState] = useState<{ loaded: boolean; error: Error | null }>({
    loaded: false,
    error: null,
  });
  const loadUmfrage = useCallback(async () => {
    if (!linkedId) return;
    try {
      const appId = (page.endpoints ?? []).find(e => e.entity === 'umfragen')?.app_id;
      if (!appId) throw new Error(tx('umfragen endpoint missing'));
      const r = await getPublicRecord(cfg, page, appId, linkedId);
      setUmfrage({
        id: r.id,
        fields: hydrateLookups('umfragen', (r.fields ?? {}) as Record<string, unknown>),
        createdAt: r.created_at ?? null,
      });
      setUmfrageState({ loaded: true, error: null });
    } catch (err) {
      setUmfrageState(s => ({ ...s, error: err instanceof Error ? err : new Error(String(err)) }));
    }
  }, [cfg, page, linkedId]);
  useEffect(() => {
    void loadUmfrage();
    const id = window.setInterval(() => void loadUmfrage(), 30000);
    return () => window.clearInterval(id);
  }, [loadUmfrage]);
  const umfragenLive = { ...umfrageState, reload: loadUmfrage };
  const termineLive = useLiveList(port, 'terminvorschlaege', { intervalMs: 30000, enabled: !!linkedId });
  const antwortenLive = useLiveList(port, 'antworten', { intervalMs: 30000, enabled: !!linkedId });

  const form = useStepForm('antworten', {
    fields: ['teilnehmer_vorname', 'teilnehmer_nachname'],
    autoComplete: true,
  });
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [voteError, setVoteError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const closed = !!umfrage && fieldLookup(umfrage, 'status')?.key === 'geschlossen';

  const termine = useMemo(
    () =>
      termineLive.records
        .filter(r => fieldRef(r, 'umfrage') === linkedId)
        .sort((a, b) => (fieldDate(a, 'beginn') ?? '').localeCompare(fieldDate(b, 'beginn') ?? '')),
    [termineLive.records, linkedId],
  );
  const antworten = useMemo(
    () => antwortenLive.records.filter(r => fieldRef(r, 'umfrage') === linkedId),
    [antwortenLive.records, linkedId],
  );
  const rows = useMemo(
    () => submissionsOf(antworten, { names: ['teilnehmer_vorname', 'teilnehmer_nachname'] }),
    [antworten],
  );

  const tally = useMemo(() => {
    const m: Record<string, { ja: number; vielleicht: number }> = {};
    for (const t of termine) m[t.id] = { ja: 0, vielleicht: 0 };
    for (const a of antworten) {
      const tid = fieldRef(a, 'terminvorschlag');
      const k = fieldLookup(a, 'antwort')?.key;
      if (!tid || !m[tid]) continue;
      if (k === 'ja') m[tid].ja += 1;
      else if (k === 'vielleicht') m[tid].vielleicht += 1;
    }
    return m;
  }, [termine, antworten]);

  const top = useMemo(
    () =>
      topOne(
        termine,
        [t => tally[t.id]?.ja ?? 0, t => tally[t.id]?.vielleicht ?? 0],
        t => fieldDate(t, 'beginn'),
      ),
    [termine, tally],
  );
  const finalId = umfrage ? fieldRef(umfrage, 'finaler_termin') : null;
  const finalTermin = termine.find(t => t.id === finalId);

  const voteValues = useCallback(
    (terminId: string) => ({ antwort: votes[terminId], terminvorschlag: terminId }),
    [votes],
  );

  const plan = useMemo<PlanStep[]>(
    () =>
      termine.map((t, i) => ({
        key: `antwort-${t.id}`,
        entity: 'antworten' as const,
        form,
        primary: i === 0,
        values: () => voteValues(t.id), // antwort: the vote, terminvorschlag: the date, umfrage: filled by the write door, never by the page
      })),
    [termine, form, voteValues],
  );

  const submit = useJourneySubmit(port, plan, {
    draftKey: `termin-abstimmen-${linkedId ?? 'ohne'}`,
    check: async () => {
      const appId = (page.endpoints ?? []).find(e => e.entity === 'umfragen')?.app_id;
      const r = linkedId && appId ? await getPublicRecord(cfg, page, appId, linkedId) : null;
      const u = r ? { id: r.id, fields: hydrateLookups('umfragen', (r.fields ?? {}) as Record<string, unknown>), createdAt: null } : null;
      if (u && fieldLookup(u, 'status')?.key === 'geschlossen') {
        return tx('Die Umfrage ist inzwischen geschlossen.');
      }
      return null;
    },
  });

  if (!linkedId) {
    return (
      <PublicShell title={tx('Terminumfrage')}>
        <p className="text-sm text-muted-foreground">
          {tx('Bitte öffne den Link oder QR-Code deiner Umfrage, um abzustimmen.')}
        </p>
      </PublicShell>
    );
  }

  const failure = [umfragenLive, termineLive, antwortenLive].find(l => l.error);
  if (failure?.error && failure.error.name === 'PageUnavailableError') {
    return (
      <PublicShell title={tx('Terminumfrage')}>
        <p className="text-sm text-muted-foreground">
          {tx('Dieser Link ist nicht mehr gültig. Bitte den aktuellen Link oder QR-Code verwenden.')}
        </p>
      </PublicShell>
    );
  }
  if (!umfragenLive.loaded || !termineLive.loaded || !antwortenLive.loaded) {
    if (failure) {
      return (
        <PublicShell title={tx('Terminumfrage')}>
          <LoadProblem
            onRetry={async () => {
              await Promise.all([umfragenLive.reload(), termineLive.reload(), antwortenLive.reload()]);
            }}
          />
        </PublicShell>
      );
    }
    return <PublicShell loading />;
  }
  if (!umfrage) {
    return (
      <PublicShell title={tx('Terminumfrage')}>
        <p className="text-sm text-muted-foreground">
          {tx('Dieser Link passt zu keiner Umfrage. Scanne bitte den QR-Code noch einmal.')}
        </p>
      </PublicShell>
    );
  }

  const send = async () => {
    setSent(false);
    const namesOk = form.validate();
    const allVoted = termine.every(t => votes[t.id]);
    if (!allVoted) setVoteError(tx('Bitte wähle für jeden Termin Ja, Vielleicht oder Nein.'));
    else setVoteError(null);
    if (!namesOk || !allVoted) return;
    const res = await submit.run();
    if (res) {
      await antwortenLive.reload();
      submit.reset();
      form.reset();
      setVotes({});
      setSent(true);
    }
  };

  const ort = fieldText(umfrage, 'ort');

  return (
    <PublicShell
      title={fieldText(umfrage, 'titel')}
      description={fieldText(umfrage, 'beschreibung') || undefined}
      wide
    >
      <div className="space-y-5">
        {ort && (
          <p className="text-sm">
            <span className="text-muted-foreground">{tx('Ort')}: </span>
            <span className="font-medium">{ort}</span>
          </p>
        )}

        {closed && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tx('Umfrage geschlossen — finaler Termin')}
            </p>
            <p className="mt-1 text-base font-semibold">
              {finalTermin
                ? `${fieldText(finalTermin, 'beginn')} – ${fieldText(finalTermin, 'ende')}`
                : tx('Noch nicht festgelegt')}
            </p>
          </div>
        )}

        {!closed && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Bound form={form} name="teilnehmer_vorname" />
            <Bound form={form} name="teilnehmer_nachname" />
          </div>
        )}

        {termine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tx('Es gibt noch keine Terminvorschläge.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-left align-bottom text-xs font-medium text-muted-foreground">
                    {tx('Teilnehmende')}
                  </th>
                  {termine.map(t => {
                    const hot = top?.id === t.id;
                    const isFinal = closed && t.id === finalId;
                    return (
                      <th
                        key={t.id}
                        className={`min-w-[96px] p-2 text-center align-bottom text-xs font-semibold ${
                          hot || isFinal ? 'bg-primary/15' : ''
                        }`}
                      >
                        {(hot || isFinal) && (
                          <span className="mb-1 block text-[10px] font-medium uppercase text-primary">
                            {isFinal ? tx('Final') : tx('Beliebteste Wahl')}
                          </span>
                        )}
                        <span className="block">{fieldText(t, 'beginn')}</span>
                        <span className="block font-normal text-muted-foreground">
                          {tx('bis')} {fieldText(t, 'ende')}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.key} className="border-t">
                    <td className="sticky left-0 z-10 max-w-[40vw] truncate bg-card p-2 font-medium">
                      {s.label}
                    </td>
                    {termine.map(t => {
                      const rec = s.records.find(r => fieldRef(r, 'terminvorschlag') === t.id);
                      const v = rec ? fieldLookup(rec, 'antwort') : null;
                      const style = v ? VOTE_STYLE[v.key as Vote] : undefined;
                      return (
                        <td
                          key={t.id}
                          className={`p-2 text-center ${top?.id === t.id ? 'bg-primary/5' : ''}`}
                        >
                          <span className={`text-xs font-medium ${style?.text ?? 'text-muted-foreground'}`}>
                            {v ? v.label : '–'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!closed && (
                  <tr className="border-t bg-muted/20">
                    <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-xs font-semibold">
                      {tx('Deine Antwort')}
                    </td>
                    {termine.map(t => (
                      <td key={t.id} className="p-1 text-center">
                        <div role="radiogroup" data-key="terminvorschlag" aria-label={fieldText(t, 'beginn')} className="flex flex-col gap-1">
                          {(['ja', 'vielleicht', 'nein'] as Vote[]).map(v => (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              className="min-h-11 min-w-11 rounded-md border bg-background px-2 text-xs font-medium hover:bg-muted aria-checked:text-white data-[vote=ja]:aria-checked:border-emerald-600 data-[vote=ja]:aria-checked:bg-emerald-600 data-[vote=vielleicht]:aria-checked:border-amber-500 data-[vote=vielleicht]:aria-checked:bg-amber-500 data-[vote=nein]:aria-checked:border-rose-600 data-[vote=nein]:aria-checked:bg-rose-600"
                              aria-checked={votes[t.id] === v}
                              onClick={() => setVotes(prev => ({ ...prev, [t.id]: v }))}
                              data-vote={v}
                            >
                              {v === 'ja' ? tx('Ja') : v === 'vielleicht' ? tx('Vielleicht') : tx('Nein')}
                            </button>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-xs font-semibold">{tx('Ja')}</td>
                  {termine.map(t => (
                    <td
                      key={t.id}
                      className={`p-2 text-center font-semibold text-emerald-700 ${
                        top?.id === t.id ? 'bg-primary/15' : ''
                      }`}
                    >
                      {tally[t.id]?.ja ?? 0}
                    </td>
                  ))}
                </tr>
                <tr className="border-t">
                  <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-xs font-semibold">
                    {tx('Vielleicht')}
                  </td>
                  {termine.map(t => (
                    <td
                      key={t.id}
                      className={`p-2 text-center font-semibold text-amber-700 ${
                        top?.id === t.id ? 'bg-primary/15' : ''
                      }`}
                    >
                      {tally[t.id]?.vielleicht ?? 0}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!closed && termine.length > 0 && (
          <div className="space-y-2">
            {voteError && <p className="text-sm text-destructive">{voteError}</p>}
            {submit.offline && (
              <p className="text-sm text-muted-foreground">
                {tx('Keine Verbindung — deine Eingaben sind gesichert.')}
              </p>
            )}
            {submit.error && !submit.offline && (
              <p className="text-sm text-destructive">{submit.error.message}</p>
            )}
            {sent && (
              <p className="text-sm font-medium text-emerald-700">
                {tx('Danke! Deine Antwort ist gespeichert.')}
              </p>
            )}
            <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={submit.submitting} onClick={send}>
              {submit.submitting ? tx('Wird gespeichert …') : tx('Antwort speichern')}
            </Button>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
