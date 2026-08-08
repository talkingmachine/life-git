export interface ProfileCardData {
  housingAll: string;
  incomeBasis: "foreign_contract" | "albanian_employer_only";
  monthlyIncomeRub: string;
  availableResourcesAll: string;
  companionMode: "staged" | "none" | "separate";
}

interface ProfileCardProps {
  profile: ProfileCardData;
  canSaveC0: boolean;
  onSaveC0: () => void;
}

function formatAll(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function ProfileCard({ profile, canSaveC0, onSaveC0 }: ProfileCardProps) {
  return (
    <section aria-labelledby="profile-heading" className="profile-card">
      <h2 id="profile-heading">Подтверждённый снимок условий</h2>
      <ul>
        <li>Жильё: {formatAll(profile.housingAll)} ALL · сценарий C0</li>
        <li>Основание дохода: {
          profile.incomeBasis === "foreign_contract"
            ? "иностранный контракт"
            : "только албанский работодатель"
        } · ввод пользователя</li>
        <li>Месячный доход: {formatAll(profile.monthlyIncomeRub)} RUB · ввод пользователя</li>
        <li>Ресурсы: {formatAll(profile.availableResourcesAll)} ALL · ввод пользователя</li>
        <li>{
          profile.companionMode === "staged"
            ? "Спутник: поэтапно — условие сценария"
            : profile.companionMode === "none"
              ? "Маршрут без спутника"
              : "Спутник: отдельный маршрут требует проверки"
        }</li>
      </ul>
      <p>Это неизменяемый снимок пользовательских данных и сценарных условий, а не подтверждение официальных требований.</p>
      {canSaveC0 ? (
        <button onClick={onSaveC0} type="button">Зафиксировать C0</button>
      ) : null}
    </section>
  );
}
