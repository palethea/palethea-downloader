import { useState } from 'react'
import { ChevronDownIcon } from '../components/Icons'

const STEPS = [
  {
    title: 'Paste Source',
    description: 'Paste any YouTube, SoundCloud, Instagram, or TikTok URL. Our engine validates the link and establishes a direct handshake with the source endpoint.',
  },
  {
    title: 'Choose Format',
    description: 'Select MP4 video or MP3 audio. Palethea automatically identifies the highest available quality and re-encodes to match your selection.',
  },
  {
    title: 'Download',
    description: 'Initiate the extraction. Monitor progress through our minimalist telemetry dashboard and download directly when ready.',
  },
]

const FAQS = [
  {
    question: 'Is it free?',
    answer: 'Palethea is completely free for standard use, covering MP3 and MP4 downloads at up to 1080p. For 4K video extraction and priority server access, a Premium subscription is available.',
  },
  {
    question: 'What formats are supported?',
    answer: 'We support MP4 video (H.264 / HEVC) and MP3 audio (up to 320kbps). Additional formats including WAV, FLAC, and WebM are available with Premium.',
  },
  {
    question: 'Is my data private?',
    answer: "Absolutely. We don't store URLs, track usage, or set cookies. All processing happens in ephemeral containers that are purged immediately after your download completes.",
  },
  {
    question: 'Are there download limits?',
    answer: 'Free users can process unlimited downloads with no daily caps. During peak traffic, Premium users receive priority queue placement for faster processing.',
  },
  {
    question: 'What if a video isn\'t supported?',
    answer: "If a video cannot be extracted, you'll receive a clear error with the reason. You can report unsupported cases through our Contact page and we update our extraction engine weekly.",
  },
]

export default function HowItWorks() {
  const [openFaq, setOpenFaq] = useState(null)

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index)
  }

  return (
    <div className="page-wrapper">
      <section className="hiw-hero">
        <h1 className="display-lg animate-in">
          Precision Utility.<br />Simplified Knowledge.
        </h1>
        <p className="body-lg animate-in">
          Understand how Palethea extracts and routes your media with invisible efficiency and precision across the modern web.
        </p>
      </section>

      <section className="hiw-content">
        <div className="mechanism">
          <h2>The Mechanism</h2>
          <div className="steps">
            {STEPS.map((step, i) => (
              <div className="step animate-in" key={i}>
                <div className="step-number">{i + 1}</div>
                <div className="step-content">
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="faq">
          <h2>Frequently Asked</h2>
          <div className="faq-list">
            {FAQS.map((faq, i) => (
              <div className={`faq-item ${openFaq === i ? 'open' : ''}`} key={i}>
                <button className="faq-question" onClick={() => toggleFaq(i)}>
                  {faq.question}
                  <ChevronDownIcon />
                </button>
                <div className="faq-answer">
                  <div className="faq-answer-inner">{faq.answer}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
