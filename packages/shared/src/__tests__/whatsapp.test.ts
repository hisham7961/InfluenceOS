import { describe, expect, it } from 'vitest';
import { whatsappLink, whatsappNumber } from '../utils/whatsapp';
import { creatorMessageLanguage, renderWhatsAppTemplate } from '../utils/whatsapp-templates';

describe('whatsappNumber', () => {
  it('adds +965 to a Kuwaiti local number', () => {
    expect(whatsappNumber('5000 0000')).toBe('96550000000');
    expect(whatsappNumber('9876-5432')).toBe('96598765432');
  });

  it('keeps an international number as typed', () => {
    expect(whatsappNumber('+965 5000 0000')).toBe('96550000000');
    expect(whatsappNumber('+966 50 123 4567')).toBe('966501234567');
    expect(whatsappNumber('0096550000000')).toBe('96550000000');
    expect(whatsappNumber('96550000000')).toBe('96550000000');
  });

  it('refuses what cannot be a phone number', () => {
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber('@creator')).toBeNull();
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappNumber('+1234567890123456')).toBeNull();
  });
});

describe('whatsappLink', () => {
  it('encodes the message, Arabic and line breaks included', () => {
    expect(whatsappLink('96550000000')).toBe('https://wa.me/96550000000');
    expect(whatsappLink('96550000000', 'مرحبا\nسارة & co')).toBe(
      'https://wa.me/96550000000?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%0A%D8%B3%D8%A7%D8%B1%D8%A9%20%26%20co',
    );
  });
});

describe('renderWhatsAppTemplate', () => {
  const brief = {
    creatorName: 'Sara',
    campaignName: 'Ramadan Glow',
    brandName: 'Luna',
    deliverables: [{ type: 'REEL', platform: 'INSTAGRAM', dueDate: '2026-10-01T00:00:00.000Z' }],
    hashtags: ['LunaGlow'],
    mentions: ['luna.kw'],
  };

  it('writes the brief in Arabic with Kuwait-day dates and Western digits', () => {
    const text = renderWhatsAppTemplate('BRIEF', 'ar', brief);
    expect(text).toContain('مرحباً Sara،');
    expect(text).toContain('حملة Ramadan Glow مع Luna');
    expect(text).toContain('• ريل على إنستغرام — قبل الخميس، 1 أكتوبر');
    expect(text).toContain('الهاشتاقات: #LunaGlow');
    expect(text).toContain('الإشارة إلى: @luna.kw');
  });

  it('writes the same brief in English', () => {
    const text = renderWhatsAppTemplate('BRIEF', 'en', brief);
    expect(text).toContain('For the Ramadan Glow campaign with Luna');
    expect(text).toContain('• Reel on Instagram — by Thursday 1 October');
  });

  it('puts the fee in the offer, and says so when the deal is a product', () => {
    const paid = renderWhatsAppTemplate('OFFER', 'en', { ...brief, fee: { amount: 250, currency: 'KWD' } });
    expect(paid).toMatch(/Fee: KWD\s?250/);
    const gifted = renderWhatsAppTemplate('OFFER', 'ar', { creatorName: 'Sara', gifted: true });
    expect(gifted).toContain('المقابل: منتج هدية');
  });

  it('includes tracking in a shipment update and leaves out what is unknown', () => {
    const text = renderWhatsAppTemplate('SHIPMENT', 'en', { creatorName: 'Sara', trackingNumber: 'AB123' });
    expect(text).toContain('Tracking number: AB123');
    expect(text).not.toContain('Courier:');
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('uses the review note when asking for changes', () => {
    const text = renderWhatsAppTemplate('CHANGES', 'ar', { creatorName: 'Sara', feedback: 'نرجو تغيير الموسيقى' });
    expect(text).toContain('نرجو تغيير الموسيقى');
  });
});

describe('creatorMessageLanguage', () => {
  it('picks the first language on the profile that has templates', () => {
    expect(creatorMessageLanguage(['Arabic', 'English'])).toBe('ar');
    expect(creatorMessageLanguage(['French', 'English'])).toBe('en');
    expect(creatorMessageLanguage(['العربية'])).toBe('ar');
    expect(creatorMessageLanguage(['French'])).toBeNull();
    expect(creatorMessageLanguage([])).toBeNull();
  });
});
