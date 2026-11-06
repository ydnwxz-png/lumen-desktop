// Настройки автоматики по умолчанию.
export const DEFAULTS = {
  pollMs: 4000,
  delivery: { on: true, rules: [] }, // {id, name, lotId, node, text, byAmount, disableWhenEmpty, on}
  commands: { on: true, rules: [] }, // {id, triggers, text, contains, notify, on}
  greeting: { on: false, text: '$welcome, $username! 👋\nСпасибо, что написали — отвечу в ближайшее время.', cooldownDays: 30 },
  reviews: { on: false, overwrite: false, texts: { 1: '', 2: '', 3: '', 4: 'Спасибо за отзыв, $username! 🤝', 5: 'Спасибо за отзыв, $username! Рад, что всё понравилось 💜' } },
  thanks: { on: false, text: 'Спасибо, что подтвердил заказ $order_id, $username! 🙌\nБуду рад отзыву — это очень помогает.' },
  remind: { on: false, hours: 12, text: '$username, напоминаю: если всё получил, подтверди, пожалуйста, заказ $order_id в разделе «Покупки» 🙏' },
  restore: { on: false },
  raise: { on: false },
  blacklist: { users: [], skipDelivery: true, skipReplies: true },
  notify: { messages: true, orders: true, reviews: true, delivery: true, raise: false, start: true, commands: false },
  plugins: {}, // id -> { on, settings }
};
