import React from 'react';
import {demoVideoId} from '../data/landingPageData';

export default function DemoSection() {
  return (
    <section className="landing-section demo-section">
      <h2 className="section-title">See it in action</h2>
      <p className="section-subtitle">
        A two-minute tour of deploying a model end to end.
      </p>
      <div className="demo-video">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${demoVideoId}`}
          title="AI Runway demo"
          frameBorder="0"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
        />
      </div>
    </section>
  );
}
