import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { PageHeader } from "../components/PageHeader";
import { Icon, type IconName } from "../components/Icon";
import { useT } from "../i18n/LocaleContext";

/**
 * The reference contact form has no backend (action="#") — it's a static
 * mailto-style placeholder the lab is meant to wire up to a real email
 * service later. We keep that same "not connected to anything" behavior
 * instead of inventing a fake submit-success flow.
 *
 * The VALUES below are the reference site's own (placeholder) details, unchanged and not
 * translated: this phase only presents them; the lab supplies the real ones. Only the field
 * labels (below, via t()) are UI text.
 */
function useDetails(): { icon: IconName; label: string; value: ReactNode }[] {
  const t = useT();
  return [
    {
      icon: "map-pin",
      label: t("contact.locationLabel"),
      value: (
        <>
          Department of Computer Engineering
          <br />
          [University Name], Building [X], Room [Y]
        </>
      ),
    },
    { icon: "mail", label: t("contact.emailLabel"), value: <a href="mailto:lab@university.edu">lab@university.edu</a> },
    { icon: "clock", label: t("contact.officeHoursLabel"), value: "Monday – Friday, 09:00 – 17:00" },
    { icon: "globe", label: t("contact.universityLabel"), value: <a href="https://www.university.edu">www.university.edu</a> },
  ];
}

export function ContactPage() {
  const t = useT();
  const details = useDetails();
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <>
      <PageHeader eyebrow={t("nav.contact")} title={t("contact.pageTitle")} description={t("contact.pageDescription")} />

      <div className="container">
        <div className="contact-layout">
          <section aria-labelledby="contact-info">
            <h2 id="contact-info">{t("contact.heading")}</h2>
            <p className="contact-info__intro">{t("contact.intro")}</p>

            <dl className="info-list">
              {details.map((d) => (
                <div className="info-item" key={d.label}>
                  <span className="icon-tile icon-tile--sm" aria-hidden="true">
                    <Icon name={d.icon} size={18} />
                  </span>
                  <div>
                    <dt className="info-item__label">{d.label}</dt>
                    <dd className="info-item__value">{d.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>

          <section className="form-card" aria-labelledby="contact-form-title">
            <h2 id="contact-form-title" className="sr-only">
              {t("contact.formHeadingSr")}
            </h2>
            {submitted ? (
              <div className="form-success" role="status">
                {t("contact.notConnectedNotice")}
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="name">{t("contact.fullNameLabel")}</label>
                  <input type="text" id="name" name="name" placeholder={t("contact.fullNamePlaceholder")} autoComplete="name" required />
                </div>

                <div className="form-group">
                  <label htmlFor="email">{t("contact.emailAddressLabel")}</label>
                  <input type="email" id="email" name="email" placeholder={t("contact.emailAddressPlaceholder")} autoComplete="email" required />
                </div>

                <div className="form-group">
                  <label htmlFor="subject">{t("contact.subjectLabel")}</label>
                  <select id="subject" name="subject">
                    <option>{t("contact.subjectResearchCollab")}</option>
                    <option>{t("contact.subjectPhdApplication")}</option>
                    <option>{t("contact.subjectPostdocInquiry")}</option>
                    <option>{t("contact.subjectGeneralQuestion")}</option>
                    <option>{t("contact.subjectPressMedia")}</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="message">{t("contact.messageLabel")}</label>
                  <textarea id="message" name="message" placeholder={t("contact.messagePlaceholder")} required />
                </div>

                <button type="submit" className="btn btn--primary btn--lg btn--block form-submit">
                  {t("contact.sendMessage")} <Icon name="arrow-right" size={16} />
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
