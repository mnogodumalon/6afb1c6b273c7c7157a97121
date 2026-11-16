/**
 * Umfrage abschließen — 3-Schritt-Wizard.
 * Steps: 1) Offene Umfrage wählen → 2) Finalen Termin aus den Terminvorschlägen wählen → 3) Prüfen & schließen.
 * Reads: umfragen, terminvorschlaege. Writes: umfragen (finaler_termin, status=geschlossen — ändert den Datensatz).
 * Composes: IntentWizardShell, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { fieldDate, fieldLookup, fieldRef, fieldText } from '@/lib/journey';
import { useUmfrageAbschliessenFlow } from '@/lib/journey/flows/UmfrageAbschliessen';
import { tx } from '@/i18n';

function fmt(iso: string | null): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'dd.MM.yyyy HH:mm');
  } catch {
    return iso;
  }
}

export default function UmfrageAbschliessenPage() {
  const [step, setStep] = useState(1);
  // The Terminvorschläge offered in step 2 belong to the Umfrage picked in step 1.
  const pickedUmfrage = useRef<string | null>(null);

  const flow = useUmfrageAbschliessenFlow({
    steps: { umfragen: 1, finaler_termin: 2 },
    items: {
      umfragen: r => ({
        id: r.id,
        title: fieldText(r, 'titel'),
        subtitle: fieldText(r, 'ort') || undefined,
        status: fieldLookup(r, 'status') ?? undefined,
      }),
      finaler_termin: r => {
        const von = fmt(fieldDate(r, 'beginn'));
        const bis = fmt(fieldDate(r, 'ende'));
        return { id: r.id, title: von, subtitle: bis ? tx`bis ${bis}` : undefined };
      },
    },
    where: {
      finaler_termin: r => pickedUmfrage.current !== null && fieldRef(r, 'umfrage') === pickedUmfrage.current,
    },
  });

  const umfragePick = flow.pick('umfragen');
  pickedUmfrage.current = umfragePick.selectedId ?? null;
  const umfrageTitel = umfragePick.selectedId ? flow.picks.umfragen.labelOf(umfragePick.selectedId) : undefined;

  return (
    <IntentWizardShell
      title={tx('Umfrage abschließen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{
        description: tx('Wähle den finalen Termin und schließe die Umfrage.'),
        needs: [tx('Eine offene Umfrage mit Terminvorschlägen')],
      }}
    >
      <WizardStep label={tx('Umfrage')} description={tx('Welche Umfrage möchtest du abschließen?')}>
        <EntitySelectStep
          {...flow.picks.umfragen.select}
          {...umfragePick}
          avatar="none"
          searchPlaceholder={tx('Titel suchen …')}
          emptyText={tx('Es gibt keine offene Umfrage zum Abschließen.')}
        />
      </WizardStep>
      <WizardStep
        label={tx('Finaler Termin')}
        description={
          umfrageTitel
            ? tx`Welcher Terminvorschlag aus „${umfrageTitel}“ soll gelten?`
            : tx('Welcher Terminvorschlag soll gelten?')
        }
      >
        {umfragePick.selectedId ? (
          <EntitySelectStep
            {...flow.picks.finaler_termin.select}
            {...flow.pick('finaler_termin')}
            avatar="none"
            create={false}
            emptyText={tx('Diese Umfrage hat noch keine Terminvorschläge.')}
          />
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        )}
      </WizardStep>
      <WizardStep label={tx('Prüfen')} description={tx('Alles richtig? Danach ist die Umfrage geschlossen.')}>
        {!flow.submit.done && (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            items={[{ key: 'status', label: tx('Status'), value: tx('Geschlossen') }]}
            whatHappensNext={tx('Der Termin wird festgelegt und die Umfrage geschlossen. Du kannst sie danach wieder öffnen.')}
          />
        )}
      </WizardStep>
      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          submit={flow.submit}
          undo={flow.undo}
          next={[
            { label: tx('Weitere Umfrage abschließen'), onClick: () => { flow.reset(); setStep(1); } },
            { label: tx('Umfrage mit Terminen anlegen'), href: '#/intents/umfrage-anlegen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
