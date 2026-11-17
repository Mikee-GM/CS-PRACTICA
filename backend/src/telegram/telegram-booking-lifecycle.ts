// El ciclo de vida de la reserva no depende del canal y vive en `booking/`.
// Este reexport mantiene los imports de Telegram mientras se migran.
export * from '../booking/booking-lifecycle';
