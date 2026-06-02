import React from 'react';
import Layout from '@theme/Layout';
import HeroSection from '../components/HeroSection';
import QuickStartSection from '../components/QuickStartSection';
import FeaturesSection from '../components/FeaturesSection';
import ProvidersSection from '../components/ProvidersSection';
import DemoSection from '../components/DemoSection';
import CtaSection from '../components/CtaSection';

export default function Home() {
  return (
    <Layout
      title="AI Runway"
      description="Deploy and manage large language models on Kubernetes — no YAML required."
    >
      <main className="landing-main">
        <HeroSection />
        <QuickStartSection />
        <FeaturesSection />
        <ProvidersSection />
        <DemoSection />
        <CtaSection />
      </main>
    </Layout>
  );
}
