import React from 'react';
import {features} from '../data/landingPageData';

export default function FeaturesSection() {
  return (
    <section className="landing-section features-section">
      <h2 className="section-title">Highlights</h2>
      <div className="features-grid">
        {features.map((feature) => (
          <div key={feature.title} className="feature-card">
            <div className="feature-emoji" aria-hidden="true">
              {feature.emoji}
            </div>
            <h3 className="feature-title">{feature.title}</h3>
            <p className="feature-description">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
