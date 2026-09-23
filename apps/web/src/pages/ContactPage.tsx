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
 * The details below are the reference site's own (placeholder) details, unchanged: this phase only
 * presents them; the lab supplies the real ones.
 */
const DETAILS: { icon: IconName; label: string; value: ReactNode }[] = [
  {
    icon: "map-pin",
    label: "Location",
    value: (
      <>
        Department of Computer Engineering
        <br />
        [University Name], Building [X], Room [Y]
      </>
    ),
  },
  { icon: "mail", label: "Email", value: <a href="mailto:lab@university.edu">lab@university.edu</a> },
  { icon: "clock", label: "Office Hours", value: "Monday – Friday, 09:00 – 17:00" },
  { icon: "globe", label: "University", value: <a href="https://www.university.edu">www.university.edu</a> },
];

export function ContactPage() {
  const t = useT();
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
            <h2 id="contact-info">Smart Computing Lab</h2>
            <p className="contact-info__intro">
              We welcome inquiries from prospective students, industry partners, and fellow researchers. Fill out the form or reach us directly using
              the details below.
            </p>

            <dl className="info-list">
              {DETAILS.map((d) => (
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
              Send a message
            </h2>
            {submitted ? (
              <div className="form-success" role="status">
                This form isn't connected to an email service yet — nothing was sent. Please use the email address above in the meantime.
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="name">Full name</label>
                  <input type="text" id="name" name="name" placeholder="Your full name" autoComplete="name" required />
                </div>

                <div className="form-group">
                  <label htmlFor="email">Email address</label>
                  <input type="email" id="email" name="email" placeholder="you@example.com" autoComplete="email" required />
                </div>

                <div className="form-group">
                  <label htmlFor="subject">Subject</label>
                  <select id="subject" name="subject">
                    <option>Research collaboration</option>
                    <option>PhD application</option>
                    <option>Postdoc inquiry</option>
                    <option>General question</option>
                    <option>Press / media</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="message">Message</label>
                  <textarea id="message" name="message" placeholder="Tell us about yourself or your inquiry..." required />
                </div>

                <button type="submit" className="btn btn--primary btn--lg btn--block form-submit">
                  Send message <Icon name="arrow-right" size={16} />
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
