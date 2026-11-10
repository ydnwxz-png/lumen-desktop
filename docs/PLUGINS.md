# Плагины Lumen

Плагин — это один файл `.js`, который работает в приложении Lumen (вкладка «Автоматика»).

- **Приложение:** Автоматика → Плагины → Установить (или кнопка «Папка»).

Новый плагин всегда выключен — включи его переключателем.

> ⚠️ Плагин получает полный доступ к аккаунту FunPay. Ставь только те, которым доверяешь.

Плагины — для тех, кто умеет немного писать на JavaScript. Без плагинов Lumen полностью работает.

---

## Самый простой плагин

```js
export default {
  name: 'Время',
  description: 'Отвечает на «!время» текущим временем',

  async onMessage(e, api) {
    if (e.mine || e.system) return;
    if (e.text.trim() === '!время') await api.send(e.chat.id, new Date().toLocaleTimeString('ru-RU'));
  },
};
```

## Что можно описать

| Поле | Зачем |
|---|---|
| `id` | Уникальное имя латиницей (если нет — берётся имя файла) |
| `name`, `version`, `author`, `description` | Как плагин выглядит в списке |
| `settings` | Настройки: Lumen сам нарисует для них поля в приложении |
| `onStart`, `onStop` | Плагин включили / выключили / программа запустилась |
| `onMessage(e)` | Новое сообщение в чате |
| `onOrder(e)` | Новый заказ |
| `onOrderStatus(e)` | Заказ закрыт или возвращён |
| `onReview(e)` | Покупатель оставил или изменил отзыв |
| `page` | Своя вкладка слева в меню: `{ title, icon, html }` — см. ниже |
| `onDelivery(e)` | Автовыдача отправила товар |
| `onTick(e)` | Раз в минуту |

Все обработчики могут быть `async`. Если плагин падает или зависает дольше 30 секунд, ошибка уходит в журнал, а остальная автоматика продолжает работать.

### Настройки

```js
settings: [
  { key: 'text',  label: 'Текст ответа',      type: 'textarea', default: 'Привет!' },
  { key: 'hours', label: 'Через сколько часов', type: 'number',   default: 2 },
  { key: 'loud',  label: 'Присылать уведомление', type: 'bool',   default: true },
],
```

Типы: `text`, `textarea`, `number`, `bool`. Значения — в `api.settings.<key>`.

---

## События

**`onMessage(e)`**
```js
e.chat     // { id, name }       — id чата, в него можно отвечать
e.text     // текст сообщения
e.author   // ник автора
e.mine     // true — это твоё сообщение
e.system   // true — оповещение FunPay («Покупатель оплатил заказ…»)
e.image    // ссылка на картинку, если прислали картинку
e.message  // всё сообщение целиком (id, дата…)
```

**`onOrder(e)`** · **`onDelivery(e)`** · **`onOrderStatus(e)`**
```js
e.order.id        // 'ABCD1234'
e.order.desc      // описание лота из заказа
e.order.price     // '249 ₽'
e.order.amount    // 249 (число)
e.order.peer      // ник покупателя
e.order.state     // 'paid' | 'closed' | 'refunded'
e.order.chatNode  // чат с покупателем — сюда можно писать
e.products        // (onDelivery) выданные товары
e.from, e.to      // (onOrderStatus) старый и новый статус
```

**`onReview(e)`**: `e.orderId`, `e.rating` (1–5), `e.text`, `e.buyer`, `e.order` (полная информация о заказе).

---

## `api` — что умеет плагин

```js
await api.send(chatId, 'текст')                    // написать в чат
await api.sendImage(chatId, buffer, 'img.png')     // отправить картинку
api.fill('Привет, $username!', { username: 'bob' }) // подставить переменные
api.notify('текст', { chat })                      // уведомление: всплывашка в приложении
api.log('текст') / api.warn('текст')               // в журнал
api.settings                                       // значения настроек
api.storage.get('key', поУмолчанию)                // своё хранилище, переживает перезапуск
api.storage.set('key', value)
api.chatWith(userId)                               // id личного чата с пользователем
api.me                                             // { userId, username, balance }
api.engine.info()                                  // статистика: сегодня заказов, выдач, сообщений…
```

**`api.account` — всё, что умеет Lumen с FunPay:**

```js
await api.account.chats()                       // список чатов
await api.account.lastMessages(chatId)          // последние сообщения
await api.account.order('ABCD1234')             // заказ: статус, параметры, отзыв
await api.account.refund('ABCD1234')            // вернуть деньги
await api.account.review(orderId, 'текст')      // ответить на отзыв
await api.account.trades('sales', 'paid', '')   // продажи (paid / closed / refunded)
await api.account.transactions('')              // финансы
await api.account.profile(userId)               // профиль пользователя
await api.account.myLots()                      // мои лоты по категориям
await api.account.lotSetActive(lot, true)       // включить / выключить лот
await api.account.lotSetPrice(lot, 199)         // поменять цену
await api.account.raiseGames()                  // что можно поднять
await api.account.raiseGame(gameId, nodes)      // поднять
```

---

## Переменные в текстах

`$username` `$welcome` `$order_id` `$order_link` `$lot_name` `$price` `$product` `$stars` `$my_name` `$message` `$date` `$time`

---

## Совет

Плагины для ботов на Python напрямую не подойдут, но логику обычно легко перенести: обработчик нового сообщения у нас `onMessage`, нового заказа — `onOrder`.


---

## Своя вкладка в меню (page)

Плагин может показать свою страницу: у включённого плагина с полем `page` слева появляется кнопка.

```js
export default {
  id: 'my-page',
  name: 'Моя страница',
  page: {
    title: 'Моя страница',   // подсказка у кнопки
    icon: 'calc',            // иконка Lumen (gamepad, calc, cash, box, star…) или эмодзи
    html: `<h1>Привет!</h1>
      <button class="btn pri" id="b">Курс вывода</button>
      <script>
        b.onclick = async () => {
          const r = await lumen.fp.withdrawRate();
          lumen.toast('Курс', r.rate + ' ₽ за USDT', 'ok');
        };
      </script>`,
  },
};
```

Страница открывается в отдельном окошке. Стили Lumen уже подключены: `.card`, `.btn`, `.btn.pri`, `.btn.sm`, `.input`, `.select`, `.textarea`, `.pill`, `.chip-btn`, `.tabs`, цвета `var(--a1)`, `var(--text)` и т. д. — они меняются вместе с темой.

### window.lumen

Все функции возвращают Promise.

| Функция | Что делает |
|---|---|
| `lumen.me()` | `{ userId, username, balance }` |
| `lumen.chats()` | Список чатов `[{ id, name, preview, unread, time }]` |
| `lumen.openChat()` | Открытый сейчас чат `{ id, name }` или `null` |
| `lumen.send(chatId, text)` | Отправить сообщение |
| `lumen.toast(title, body, kind)` | Всплывашка; `kind`: `'ok'` / `'err'` / `''` |
| `lumen.confirm(title, text, yes)` | Окно «Да / Отмена» → `true` / `false` |
| `lumen.copy(text)` | Скопировать в буфер |
| `lumen.open(url)` | Открыть ссылку (FunPay — внутри Lumen) |
| `lumen.translate(text)` | Перевод RU → EN |
| `lumen.storage.get(key, def)` / `.set(key, value)` | Сохранить данные страницы |
| `lumen.fp.myLots()` | Свои лоты по разделам |
| `lumen.fp.lotNewForm(node)` | Поля нового лота в разделе: `{ form, selects: [{ name, label, options }] }` |
| `lumen.fp.lotCreate({ node, title:{ru,en}, desc:{ru,en}, price, amount, selects:{name:value} })` | Создать лот → `{ id, url }` |
| `lumen.fp.withdrawRate()` | Курс вывода в USDT: `{ rate, fee, min }` |
