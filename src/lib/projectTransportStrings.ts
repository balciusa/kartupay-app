import type { ProjectDateLocale } from './projectDateStrings'

export const projectTransportStrings = {
  en: {
    transport: 'Transport', toEvent: 'To event', fromEvent: 'From event', status: 'Transport status',
    yourTransport: 'Your transport', availableRides: 'Available rides', offerRide: 'Offer a ride',
    needRideAction: 'I need a ride', ownArrangementAction: 'I have my own arrangement',
    leavingFrom: 'Leaving from', goingTo: 'Going to', departure: 'Departure',
    passengerSeats: 'Available passenger seats', noteOptional: 'Note (optional)', joinRide: 'Join ride',
    leaveRide: 'Leave ride', editRide: 'Edit ride', cancelRide: 'Cancel ride', removePassenger: 'Remove passenger',
    needRide: 'Need a ride', ownArrangement: 'Own arrangement', notDecided: 'Not decided yet',
    seatsAvailable: 'Seats available', full: 'Full', change: 'Change', clear: 'Clear', drivers: 'Drivers',
    passengers: 'Passengers assigned', event: 'Event', passengersList: 'Passengers', noPassengers: 'No passengers yet.',
    cancel: 'Cancel', routeLocked: 'Route and departure cannot change while passengers are assigned.',
    attendingOnly: 'Transport actions are available to participants attending the event.',
    noRides: 'No rides have been offered yet.', noNeedsRide: 'Nobody currently needs a ride.',
    planningLocked: 'Transport planning will be available after the final event date is selected.',
    canceledLocked: 'Transport changes are unavailable because this project is canceled.',
    cancelWarning: (count: number) => `Canceling this ride will leave ${count} passengers needing transport.`,
    ridingWith: (name: string) => `You're riding with ${name}`,
    seatsOf: (remaining: number, total: number) => `${remaining} of ${total} seats available`,
  },
  lt: {
    transport: 'Transportas', toEvent: 'Į renginį', fromEvent: 'Iš renginio', status: 'Transporto situacija',
    yourTransport: 'Jūsų transportas', availableRides: 'Galimi pavežimai', offerRide: 'Pasiūlyti pavežti',
    needRideAction: 'Man reikia pavežimo', ownArrangementAction: 'Transportu pasirūpinau pats',
    leavingFrom: 'Išvykimo vieta', goingTo: 'Kelionės tikslas', departure: 'Išvykimo laikas',
    passengerSeats: 'Laisvos vietos keleiviams', noteOptional: 'Pastaba (nebūtina)', joinRide: 'Prisijungti prie važiavimo',
    leaveRide: 'Atsisakyti vietos', editRide: 'Redaguoti važiavimą', cancelRide: 'Atšaukti važiavimą',
    removePassenger: 'Pašalinti keleivį', needRide: 'Reikia pavežimo', ownArrangement: 'Transportu pasirūpinta',
    notDecided: 'Dar nepasirinkta', seatsAvailable: 'Laisvos vietos', full: 'Vietų nėra', change: 'Keisti',
    clear: 'Išvalyti', drivers: 'Vairuotojai', passengers: 'Priskirti keleiviai', event: 'Renginys',
    passengersList: 'Keleiviai', noPassengers: 'Keleivių dar nėra.', noRides: 'Pavežimų dar nepasiūlyta.',
    cancel: 'Atšaukti', routeLocked: 'Kai yra priskirtų keleivių, maršruto ir išvykimo laiko keisti negalima.',
    attendingOnly: 'Transporto veiksmus gali atlikti renginyje dalyvaujantys grupės nariai.',
    noNeedsRide: 'Šiuo metu pavežimo niekam nereikia.',
    planningLocked: 'Transportą galėsite planuoti, kai bus pasirinkta galutinė renginio data.',
    canceledLocked: 'Transporto keisti negalima, nes projektas atšauktas.',
    cancelWarning: (count: number) => `Atšaukus šį važiavimą, ${count} keleiviams vėl reikės transporto.`,
    ridingWith: (name: string) => `Važiuojate su ${name}`,
    seatsOf: (remaining: number, total: number) => `Laisvų vietų: ${remaining} iš ${total}`,
  },
} as const

export function getProjectTransportStrings(locale: ProjectDateLocale) {
  return projectTransportStrings[locale]
}
