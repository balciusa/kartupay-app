import { getProjectDateStrings, type ProjectDateLocale } from './projectDateStrings.ts'
import { getProjectFinanceStrings } from './projectFinanceStrings.ts'
import type { ProjectSuccessPath, SuccessAction, SuccessStage } from './projectSuccessPath.ts'

type SuccessOverviewStrings = {
  region: string
  projectStatus: string
  relevantStages: string
  stages: Record<SuccessStage, string>
  stageStates: Record<'current' | 'upcoming' | 'complete', string>
  health: Record<ProjectSuccessPath['health'], string>
  actions: Record<SuccessAction, { title: string; detail: string; label: string }>
  headings: Record<'canceled' | 'finalized' | 'ready' | 'waiting', string>
  details: Record<'canceled' | 'finalized' | 'ready' | 'waiting' | 'date' | 'date_tie' | 'finance', string>
  participantMinimum: (confirmed: number, minimum: number) => string
  participantNoMinimum: (confirmed: number) => string
  waitingParticipants: (count: number) => string
  waitingPeople: (count: number) => string
  waitingDates: (count: number) => string
  waitingAttendance: (count: number) => string
}

const enDate = getProjectDateStrings('en')
const ltDate = getProjectDateStrings('lt')
const enFinance = getProjectFinanceStrings('en')
const ltFinance = getProjectFinanceStrings('lt')

const strings: Record<ProjectDateLocale, SuccessOverviewStrings> = {
  en: {
    region: 'Project success path',
    projectStatus: 'Project status',
    relevantStages: 'Relevant project stages',
    stages: { date: enFinance.date, participants: 'Participants', finance: 'Finance', ready: 'Ready' },
    stageStates: { current: 'Current', upcoming: 'Upcoming', complete: 'Complete' },
    health: { on_track: 'Waiting for progress', needs_attention: 'Needs your attention', blocked: 'Needs attention', ready: 'Ready', canceled: 'Canceled', finalized: 'Finalized' },
    actions: {
      choose_dates: { title: 'Choose your available dates', detail: 'Your response helps the group choose a date.', label: enDate.chooseDates },
      confirm_attendance: { title: 'Confirm your attendance', detail: 'The final date is selected. Let the group know if you can attend.', label: 'Confirm attendance' },
      resolve_date: { title: 'Choose the final date', detail: 'Date Finder has an exact tie that needs your decision.', label: 'Choose final date' },
      invite_people: { title: 'Invite more people', detail: 'Share the project link with people you would like to join.', label: 'Review participants' },
      review_finance: { title: 'Review Finance', detail: 'Review the existing payment controls and outstanding base contributions.', label: 'Review payments' },
      review_payment: { title: 'Review your payment', detail: 'Your base contribution is still outstanding.', label: 'Go to payments' },
    },
    headings: { canceled: 'Project canceled', finalized: 'Project finalized', ready: 'Project ready', waiting: 'Waiting on the group' },
    details: {
      canceled: 'This project was canceled. There is no next action.',
      finalized: 'The participant list is finalized and base contributions are frozen.',
      ready: 'All relevant project requirements are met.',
      waiting: 'You have no required action right now. The group is still working toward readiness.',
      date: 'Waiting for Date Finder to select the final date.',
      date_tie: 'Waiting for the organizer to choose the final date.',
      finance: 'Base contributions are not yet settled.',
    },
    participantMinimum: (confirmed, minimum) => `${confirmed} of ${minimum} required participants confirmed.`,
    participantNoMinimum: confirmed => `${confirmed} participants confirmed. No minimum configured.`,
    waitingParticipants: count => `Waiting for ${count} more confirmed participants.`,
    waitingPeople: count => `Waiting on ${count} people:`,
    waitingDates: count => `${count} to choose dates.`,
    waitingAttendance: count => `${count} to confirm attendance.`,
  },
  lt: {
    region: ltFinance.projectProgress,
    projectStatus: 'Projekto būsena',
    relevantStages: 'Projekto etapai',
    stages: { date: ltFinance.date, participants: 'Dalyviai', finance: 'Finansai', ready: 'Pasirengta' },
    stageStates: { current: 'Dabartinis', upcoming: 'Būsimas', complete: 'Atlikta' },
    health: { on_track: 'Laukiama pažangos', needs_attention: 'Reikia jūsų dėmesio', blocked: 'Reikia dėmesio', ready: 'Pasirengta', canceled: 'Atšauktas', finalized: 'Užfiksuotas' },
    actions: {
      choose_dates: { title: ltDate.chooseDatesHelp, detail: 'Jūsų atsakymas padės grupei pasirinkti datą.', label: ltDate.chooseDates },
      confirm_attendance: { title: 'Patvirtinkite dalyvavimą', detail: 'Galutinė data pasirinkta. Praneškite grupei, ar galėsite dalyvauti.', label: 'Patvirtinti dalyvavimą' },
      resolve_date: { title: 'Pasirinkite galutinę datą', detail: ltDate.organizerDecisionHelp, label: 'Pasirinkti galutinę datą' },
      invite_people: { title: ltFinance.inviteMorePlural, detail: 'Pasidalykite projekto nuoroda su žmonėmis, kuriuos norite pakviesti.', label: 'Peržiūrėti dalyvius' },
      review_finance: { title: 'Peržiūrėkite finansus', detail: 'Peržiūrėkite mokėjimų valdymo parinktis ir dar nesumokėtas pagrindines įmokas.', label: 'Peržiūrėti mokėjimus' },
      review_payment: { title: 'Peržiūrėkite savo mokėjimą', detail: 'Jūsų pagrindinė įmoka dar nesumokėta.', label: 'Eiti į mokėjimus' },
    },
    headings: { canceled: 'Projektas atšauktas', finalized: 'Projektas užfiksuotas', ready: 'Projektui pasirengta', waiting: 'Laukiama grupės' },
    details: {
      canceled: 'Šis projektas atšauktas. Daugiau veiksmų nereikia.',
      finalized: 'Dalyvių sąrašas užfiksuotas, o pagrindinės įmokos nebekeičiamos.',
      ready: 'Visi projektui taikomi reikalavimai įvykdyti.',
      waiting: 'Šiuo metu jums nereikia atlikti jokių veiksmų. Grupė dar ruošiasi projektui.',
      date: 'Laukiama, kol datų parinkimo sistema parinks galutinę datą.',
      date_tie: 'Laukiama, kol organizatorius pasirinks galutinę datą.',
      finance: 'Pagrindinės įmokos dar nesumokėtos.',
    },
    // Label-style counts stay grammatical for 0, 1, 2, 10, 11, 21, etc.
    participantMinimum: (confirmed, minimum) => `Dalyvavimą patvirtino: ${confirmed}. Būtinas minimumas: ${minimum}.`,
    participantNoMinimum: confirmed => `Dalyvavimą patvirtino: ${confirmed}. Minimalus skaičius nenustatytas.`,
    waitingParticipants: count => `Dar reikia dalyvavimą patvirtinusių dalyvių: ${count}.`,
    waitingPeople: count => `Laukiama atsakymų iš žmonių: ${count}.`,
    waitingDates: count => `Dar turi pasirinkti datas: ${count}.`,
    waitingAttendance: count => `Dar turi patvirtinti dalyvavimą: ${count}.`,
  },
}

export function getProjectSuccessOverviewStrings(locale: ProjectDateLocale): SuccessOverviewStrings {
  return strings[locale]
}
