// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Переменные в текстах автоматики.
export function welcome(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

export const VARS = {
  $username: 'ник покупателя',
  $welcome: 'доброе утро / день / вечер',
  $order_id: 'номер заказа (#ABCD1234)',
  $order_link: 'ссылка на заказ',
  $lot_name: 'название лота из заказа',
  $price: 'сумма заказа',
  $product: 'выданный товар',
  $stars: 'оценка в отзыве',
  $my_name: 'твой ник',
  $message: 'текст сообщения покупателя',
  $date: 'дата',
  $time: 'время',
};

export function fill(text, c = {}) {
  const d = new Date();
  const map = {
    $username: c.username || '',
    $welcome: welcome(d),
    $order_id: c.orderId ? '#' + c.orderId : '',
    $order_link: c.orderId ? `https://funpay.com/orders/${c.orderId}/` : '',
    $lot_name: c.lotName || '',
    $price: c.price || '',
    $product: c.product || '',
    $stars: c.stars ? String(c.stars) : '',
    $my_name: c.myName || '',
    $message: c.message || '',
    $date: d.toLocaleDateString('ru-RU'),
    $time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
  return String(text || '').replace(/\$[a-z_]+/g, (k) => (k in map ? map[k] : k));
}
