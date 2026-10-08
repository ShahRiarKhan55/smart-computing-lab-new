import { PageHeader } from "../components/PageHeader";
import { useSeo } from "../hooks/useSeo";
import { useT } from "../i18n/LocaleContext";

/** The copyright / academic-use notice. Wording is a draft, deliberately free of any blanket-ownership claim. */
export function CopyrightPage() {
  const t = useT();
  useSeo({ title: t("copyright.pageTitle"), description: t("copyright.pageDescription") });
  return (
    <>
      <PageHeader eyebrow={t("copyright.eyebrow")} title={t("copyright.pageTitle")} description={t("copyright.pageDescription")} />
      <div className="container prose-page">
        <p>{t("copyright.body")}</p>
        <p className="form-hint">{t("copyright.note")}</p>
      </div>
    </>
  );
}
