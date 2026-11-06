// Переменные шаблонов: $username, $order_id, $lot_name, $welcome и т.д.
export const VARS = [
  ['$username', 'ник собеседника'],
  ['$welcome', 'доброе утро / день / вечер'],
  ['$order_id', 'номер последнего заказа'],
  ['$order_link', 'ссылка на заказ'],
  ['$lot_name', 'название лота'],
  ['$my_name', 'твой ник'],
  ['$date', 'сегодняшняя дата'],
  ['$time', 'время'],
];

export function welcome(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

/** ctx: {username, myName, orderId, lotName} */
export function fill(text, ctx = {}) {
  const d = new Date();
  const map = {
    $username: ctx.username || '',
    '{buyername}': ctx.username || '',
    $welcome: welcome(d),
    $order_id: ctx.orderId ? '#' + ctx.orderId : '',
    $order_link: ctx.orderId ? `https://funpay.com/orders/${ctx.orderId}/` : '',
    $lot_name: ctx.lotName || '',
    $my_name: ctx.myName || '',
    $date: d.toLocaleDateString('ru-RU'),
    $time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
  return String(text).replace(/\$order_link|\$order_id|\$username|\$welcome|\$lot_name|\$my_name|\$date|\$time|\{buyername\}/g, (k) => map[k] ?? k);
}
