import { Faq } from './Faq';
import { Features } from './Features';
import { Footer } from './Footer';
import { ForWhom } from './ForWhom';
import { Hero } from './Hero';
import { LandingHeader } from './LandingHeader';
import { PricingScreen } from './PricingScreen';

export function LandingPage() {
  return (
    <div className="landing">
      <LandingHeader />
      <Hero />
      <Features />
      <ForWhom />
      <PricingScreen />
      <Faq />
      <Footer />
    </div>
  );
}
