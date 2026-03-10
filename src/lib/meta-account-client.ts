export const META_ACTIVE_ACCOUNT_CHANGED_EVENT = "meta:active-account-changed";

export type MetaActiveAccountChangedDetail = {
  accountId: string | null;
};

export const dispatchMetaActiveAccountChanged = (detail: MetaActiveAccountChangedDetail) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MetaActiveAccountChangedDetail>(META_ACTIVE_ACCOUNT_CHANGED_EVENT, {
      detail,
    }),
  );
};
