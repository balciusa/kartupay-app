import { getProjectDateStrings, type ProjectDateLocale } from './projectDateStrings.ts'
import type { ProjectSuccessPath, SuccessAction } from './projectSuccessPath.ts'

type SuccessOverviewStrings = {
  region: string
  title: string
  intro: string
  primaryEyebrow: string
  otherTasks: string
  noOtherTasks: string
  noActionTitle: string
  openGroup: string
  reviewPlan: string
  actions: Record<SuccessAction, { title: string; detail: (model: ProjectSuccessPath) => string; label: string }>
  headings: Record<'canceled' | 'finalized' | 'ready' | 'waiting', string>
  details: Record<'canceled' | 'finalized' | 'ready' | 'waiting' | 'date' | 'date_all_responded' | 'date_tie' | 'finance', string>
  waitingParticipants: (count: number) => string
  waitingDates: (count: number) => string
  waitingAttendance: (count: number) => string
}

const enDate = getProjectDateStrings('en')
const ltDate = getProjectDateStrings('lt')

const strings: Record<ProjectDateLocale, SuccessOverviewStrings> = {
  en: {
    region: 'Project overview',
    title: 'Overview',
    intro: 'Your most important next step and what is still left.',
    primaryEyebrow: 'MOST IMPORTANT TO DO NOW',
    otherTasks: 'Other items',
    noOtherTasks: 'There are no actions waiting in other sections.',
    noActionTitle: 'No action needed right now',
    openGroup: 'Open group',
    reviewPlan: 'Review plan',
    actions: {
      choose_dates: {
        title: 'Choose dates that work for you',
        detail: () => 'Your response helps the group choose the final date.',
        label: enDate.chooseDates,
      },
      confirm_attendance: {
        title: 'Respond about the date',
        detail: () => 'The selected date needs your response before planning can continue.',
        label: 'Respond about the date',
      },
      review_join_requests: {
        title: 'Review join requests',
        detail: model => model.pendingJoinRequests === 1
          ? '1 person is waiting to join this project.'
          : `${model.pendingJoinRequests} people are waiting to join this project.`,
        label: 'Review requests',
      },
      finalize_date_early: {
        title: 'Choose the final date',
        detail: () => 'Everyone has responded, so you can choose the final date now.',
        label: 'Choose final date',
      },
      resolve_date: {
        title: 'Choose the final date',
        detail: () => 'Date Finder has an exact tie that needs your decision.',
        label: 'Choose final date',
      },
      invite_people: {
        title: 'Invite more people',
        detail: () => 'Share the project with people you would like to join.',
        label: 'Review participants',
      },
      review_finance: {
        title: 'Review finances',
        detail: () => 'Review the current payment controls and outstanding contributions.',
        label: 'Review finances',
      },
      review_payment: {
        title: 'Review your payment',
        detail: () => 'Your personal base contribution is still outstanding.',
        label: 'Go to finances',
      },
    },
    headings: {
      canceled: 'Project canceled',
      finalized: 'Project finalized',
      ready: 'Everything is up to date',
      waiting: 'No action needed right now',
    },
    details: {
      canceled: 'This project was canceled. Any remaining refund information stays available in Finances.',
      finalized: 'The participant list is finalized and base contributions are frozen.',
      ready: 'All currently applicable project requirements are complete.',
      waiting: 'The group is still preparing, but there is nothing you need to do now.',
      date: 'The group is still choosing the final date.',
      date_all_responded: 'Everyone has responded. The organizer can choose the final date now.',
      date_tie: 'The organizer still needs to resolve the tied date result.',
      finance: 'Base contributions are not yet settled.',
    },
    waitingParticipants: count => `The project still needs ${count} more participants.`,
    waitingDates: count => `${count} people still need to choose dates.`,
    waitingAttendance: count => `${count} people still need to respond about the selected date.`,
  },
  lt: {
    region: 'Projekto apžvalga',
    title: 'Apžvalga',
    intro: 'Svarbiausias kitas žingsnis ir tai, kas dar liko.',
    primaryEyebrow: 'KĄ SVARBIAUSIA PADARYTI DABAR',
    otherTasks: 'Kiti klausimai',
    noOtherTasks: 'Kitų skilčių veiksmų nėra.',
    noActionTitle: 'Šiuo metu veiksmų nereikia',
    openGroup: 'Atidaryti grupę',
    reviewPlan: 'Peržiūrėti planą',
    actions: {
      choose_dates: {
        title: 'Pasirinkite tinkamas datas',
        detail: () => 'Jūsų atsakymas padės grupei pasirinkti galutinę datą.',
        label: ltDate.chooseDates,
      },
      confirm_attendance: {
        title: 'Atsakykite dėl datos',
        detail: () => 'Pasirinktai datai reikia jūsų atsakymo, kad planavimas galėtų tęstis.',
        label: 'Atsakyti dėl datos',
      },
      review_join_requests: {
        title: 'Peržiūrėkite prisijungimo prašymus',
        detail: model => `Laukiančių prisijungimo prašymų: ${model.pendingJoinRequests}.`,
        label: 'Peržiūrėti prašymus',
      },
      finalize_date_early: {
        title: 'Pasirinkite galutinę datą',
        detail: () => 'Visi dalyviai atsakė, todėl galutinę datą galite pasirinkti dabar.',
        label: 'Pasirinkti galutinę datą',
      },
      resolve_date: {
        title: 'Pasirinkite galutinę datą',
        detail: () => ltDate.organizerDecisionHelp,
        label: 'Pasirinkti galutinę datą',
      },
      invite_people: {
        title: 'Pakvieskite daugiau žmonių',
        detail: () => 'Pasidalykite projektu su žmonėmis, kuriuos norite pakviesti.',
        label: 'Peržiūrėti dalyvius',
      },
      review_finance: {
        title: 'Peržiūrėkite finansus',
        detail: () => 'Peržiūrėkite dabartinį mokėjimų valdymą ir nesumokėtas įmokas.',
        label: 'Peržiūrėti finansus',
      },
      review_payment: {
        title: 'Peržiūrėkite savo mokėjimą',
        detail: () => 'Jūsų asmeninė pagrindinė įmoka dar nesumokėta.',
        label: 'Eiti į finansus',
      },
    },
    headings: {
      canceled: 'Projektas atšauktas',
      finalized: 'Projektas užfiksuotas',
      ready: 'Viskas atnaujinta',
      waiting: 'Šiuo metu veiksmų nereikia',
    },
    details: {
      canceled: 'Projektas atšauktas. Likusi grąžinimų informacija tebėra pasiekiama Finansų skiltyje.',
      finalized: 'Dalyvių sąrašas užfiksuotas, o pagrindinės įmokos nebekeičiamos.',
      ready: 'Visi šiuo metu taikomi projekto reikalavimai įvykdyti.',
      waiting: 'Grupė dar ruošiasi, tačiau šiuo metu jums nieko daryti nereikia.',
      date: 'Grupė dar renkasi galutinę datą.',
      date_all_responded: 'Visi dalyviai atsakė. Organizatorius jau gali pasirinkti galutinę datą.',
      date_tie: 'Organizatorius dar turi išspręsti vienodai įvertintų datų rezultatą.',
      finance: 'Pagrindinės įmokos dar nesumokėtos.',
    },
    waitingParticipants: count => `Projektui dar trūksta dalyvių: ${count}.`,
    waitingDates: count => `Dar turi pasirinkti datas: ${count}.`,
    waitingAttendance: count => `Dar turi atsakyti dėl pasirinktos datos: ${count}.`,
  },
}

export function getProjectSuccessOverviewStrings(locale: ProjectDateLocale): SuccessOverviewStrings {
  return strings[locale]
}
