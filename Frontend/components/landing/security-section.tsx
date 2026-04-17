"use client";

import { useEffect, useState, useRef } from "react";
import { Shield, Lock, Eye, FileCheck } from "lucide-react";

const securityFeatures = [
  {
    icon: Shield,
    title: "Workplace isolation",
    description: "Each client or brand lives in its own sandbox—assets and prompts never cross projects.",
    image: "/images/isolated.jpg",
  },
  {
    icon: Lock,
    title: "Employee assets",
    description: "Creative files and exports your team creates stay protected—encrypted at rest and in transit, with clear ownership per workspace.",
    image: "/images/encrypted.jpg",
  },
  {
    icon: Eye,
    title: "Review audit trails",
    description: "Who viewed, edited, or exported what—timestamped for compliance and client sign-off.",
    image: "/images/audit.jpg",
  },
  {
    icon: FileCheck,
    title: "Role-based access",
    description: "Editors, approvers, and guests each get least-privilege access—only the libraries, briefs, and actions their role requires.",
    image: "/images/permissions.jpg",
  },
];

const certifications = ["SOC 2", "ISO 27001", "HIPAA", "GDPR"];

export function SecuritySection() {
  const [isVisible, setIsVisible] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % securityFeatures.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="security" ref={sectionRef} className="relative py-32 lg:py-40 overflow-hidden">
      {/* Background accent removed */}
      
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="mb-20">
          <span className={`inline-flex items-center gap-4 text-sm font-mono text-muted-foreground mb-8 transition-all duration-700 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}>
            <span className="w-12 h-px bg-foreground/20" />
            Security
          </span>
          
          {/* Title — full width */}
          <h2 className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] mb-12 transition-all duration-1000 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}>
            Powerful
            <br />
            <span className="text-muted-foreground">and accountable.</span>
          </h2>
          
          {/* Description — below title */}
          <div className={`transition-all duration-1000 delay-100 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
              Generative design shouldn’t mean risky files. Designer keeps briefs, references, and finals inside the policies and controls your team defines.
            </p>
          </div>
        </div>

        {/* Main content */}
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Large visual card */}
          <div className={`lg:col-span-7 relative p-8 lg:p-12 pb-28 lg:pb-12 border border-foreground/10 min-h-[400px] overflow-hidden transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}>
            {/* Dynamic feature image — positioned so it actually paints (absolute + % size was collapsing) */}
            <div className="absolute inset-0 pointer-events-none hidden lg:block" aria-hidden>
              {securityFeatures.map((feature, index) => (
                <img
                  key={feature.image}
                  src={feature.image}
                  alt=""
                  className="absolute right-0 top-1/2 max-h-[min(88%,560px)] w-[min(72%,480px)] -translate-y-1/2 object-contain object-right transition-opacity duration-500"
                  style={{ opacity: activeFeature === index ? 0.92 : 0 }}
                  loading="eager"
                  decoding="async"
                />
              ))}
            </div>

            {/* Mobile / tablet: visible preview of active security visual */}
            <div className="relative z-[5] mt-6 h-52 w-full overflow-hidden rounded-md border border-foreground/10 lg:hidden">
              <img
                src={securityFeatures[activeFeature].image}
                alt=""
                className="h-full w-full object-cover object-center"
                decoding="async"
              />
            </div>
            
            <div className="relative z-10">
              <span className="font-mono text-sm text-muted-foreground">Active protection</span>
              <div className="mt-8">
                <span className="text-7xl lg:text-8xl font-display">0</span>
                <span className="block text-muted-foreground mt-2">Unauthorized asset leaks this year</span>
              </div>
            </div>
            
            {/* Certification badges */}
            <div className="absolute bottom-8 left-8 right-8 flex flex-wrap gap-2">
              {certifications.map((cert, index) => (
                <span
                  key={cert}
                  className={`px-3 py-1 border border-foreground/10 text-xs font-mono text-muted-foreground transition-all duration-500 ${
                    isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                  }`}
                  style={{ transitionDelay: `${index * 100 + 300}ms` }}
                >
                  {cert}
                </span>
              ))}
            </div>
          </div>

          {/* Feature cards stack */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {securityFeatures.map((feature, index) => (
              <div
                key={feature.title}
                className={`p-6 border transition-all duration-500 cursor-default ${
                  activeFeature === index 
                    ? "border-foreground/30 bg-foreground/[0.04]" 
                    : "border-foreground/10"
                } ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}`}
                style={{ transitionDelay: `${index * 80}ms` }}
                onClick={() => setActiveFeature(index)}
                onMouseEnter={() => setActiveFeature(index)}
              >
                <div className="flex items-start gap-4">
                  <div className={`shrink-0 w-10 h-10 flex items-center justify-center border transition-colors ${
                    activeFeature === index 
                      ? "border-foreground bg-foreground text-background" 
                      : "border-foreground/20"
                  }`}>
                    <feature.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-medium mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
