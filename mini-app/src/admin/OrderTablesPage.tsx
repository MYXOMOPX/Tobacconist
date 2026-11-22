import type { ParticipantSummary } from '../types';
import { Button, Card, CardHead, EmptyState, formatEur, gramsLabel } from '../ui';

/** One narrow table per participant, using the same billable lines as the order totals. */
export function OrderTablesPage({
  vendorName,
  participants,
  onBack,
}: {
  vendorName: string;
  participants: ParticipantSummary[];
  onBack: () => void;
}) {
  return (
    <div className="tb-page">
      <header className="tb-stack">
        <h1 className="tb-title">Таблица заказов</h1>
        <p className="tb-subtitle">{vendorName}</p>
        <Button onClick={onBack}>← К управлению заказом</Button>
      </header>

      {participants.length === 0 ? (
        <EmptyState title="Заказов пока нет" text="Когда участники добавят позиции, здесь появятся их таблицы." />
      ) : (
        participants.map((participant) => {
          const name = participant.displayName || `Участник ${participant.userId}`;
          return (
            <Card key={participant.userId}>
              <CardHead title={name} />
              <table className="tb-order-table" aria-label={`Заказ: ${name}`}>
                <colgroup>
                  <col className="tb-order-table__product-col" />
                  <col className="tb-order-table__qty-col" />
                  <col className="tb-order-table__price-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col">Шт.</th>
                    <th scope="col" aria-label="Сумма в евро">€</th>
                  </tr>
                </thead>
                <tbody>
                  {participant.items.map((item) => (
                    <tr key={`${item.brandId}:${item.flavorId}:${item.weightId}`}>
                      <td>
                        <span className="tb-order-table__product">{item.brandName} {item.flavorName}</span>
                        <span className="tb-order-table__weight">{gramsLabel(item.grams)}</span>
                      </td>
                      <td className="tb-order-table__number">{item.deliveredQty ?? item.quantity}</td>
                      <td className="tb-order-table__number">{formatEur(item.totalEur)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>Итого</th>
                    <td className="tb-order-table__number">{formatEur(participant.totalEur)}</td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          );
        })
      )}
    </div>
  );
}
