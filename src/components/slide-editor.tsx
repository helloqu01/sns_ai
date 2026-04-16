"use client";

import React, { useState } from 'react';
import { X, Image as ImageIcon, ChevronDown, Minus, Plus } from 'lucide-react';
import { CarouselPreview, type Slide } from '@/components/carousel-preview';
import { cn } from '@/lib/utils';

// ─── Constants (shared with content-studio) ───────────────────────────────────

export const SLIDE_FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'inherit', label: 'inherit' },
  { value: 'Pretendard Variable, sans-serif', label: 'Pretendard' },
  { value: '"Noto Sans KR", sans-serif', label: 'Noto Sans KR' },
  { value: '"Nanum Gothic", sans-serif', label: 'Nanum Gothic' },
  { value: '"Gowun Batang", serif', label: 'Gowun Batang' },
];

export const SLIDE_COLOR_PRESETS = [
  '#000000', '#ffffff', '#334155', '#64748b', '#94a3b8',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
];

export const SLIDE_WEIGHT_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'L', value: 300 },
  { label: 'N', value: 400 },
  { label: 'M', value: 500 },
  { label: 'SB', value: 600 },
  { label: 'B', value: 700 },
];

export const SLIDE_SIZE_PRESETS = [12, 16, 20, 24, 32, 40, 48, 64, 80, 96];

// ─── Sub-components ────────────────────────────────────────────────────────────

function SlideThumbnail({
  slide,
  index,
  selected,
  onClick,
}: {
  slide: Slide;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const bgUrl = (slide.image || slide.renderedImageUrl || '').trim();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex-shrink-0 w-[64px] rounded-xl overflow-hidden border-2 transition-all aspect-[3/4] focus:outline-none',
        selected
          ? 'border-[#8b5cf6] ring-2 ring-[#c4b5fd] shadow-md'
          : 'border-slate-200 hover:border-slate-400',
      )}
    >
      {bgUrl ? (
        <img src={bgUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-900" />
      )}
      <div className="absolute inset-0 bg-black/40" />
      <span className="absolute top-1 left-1.5 w-4 h-4 rounded-full bg-black/50 flex items-center justify-center text-white text-[8px] font-bold leading-none">
        {index + 1}
      </span>
      <span className="absolute bottom-1 left-1 right-1 text-[7px] text-white font-semibold leading-tight line-clamp-2 break-keep">
        {slide.title}
      </span>
    </button>
  );
}

type TextLayer = 'title' | 'body';
type AccordionSection = 'background' | TextLayer;

function ColorSwatch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {SLIDE_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              'h-6 w-6 rounded-full border-2 transition-all hover:scale-110',
              value.toLowerCase() === c.toLowerCase()
                ? 'border-[#8b5cf6] scale-110'
                : 'border-white shadow-sm',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="relative w-7 h-7 rounded-md border border-slate-300 overflow-hidden cursor-pointer shadow-sm hover:shadow flex-shrink-0">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <span className="block w-full h-full" style={{ background: value }} />
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={9}
          className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-xs font-mono text-slate-700 focus:outline-none focus:border-[#8b5cf6]"
        />
      </div>
    </div>
  );
}

// ─── Layer style section (shared for title and body) ──────────────────────────

function LayerStylePanel({
  layer,
  slide,
  isCover,
  onUpdate,
}: {
  layer: TextLayer;
  slide: Slide;
  isCover: boolean;
  onUpdate: (patch: Partial<Slide>) => void;
}) {
  const isTitle = layer === 'title';
  const textValue = isTitle
    ? (slide.title ?? '')
    : (slide.body ?? slide.content ?? '');
  const style = isTitle ? slide.titleTextStyle : slide.bodyTextStyle;
  const defaultSize = isTitle ? (isCover ? 54 : 40) : (isCover ? 30 : 28);
  const defaultColor = isTitle ? '#ffffff' : '#f8fafc';

  const fontSize = style?.fontSize ?? defaultSize;
  const color = style?.color ?? defaultColor;
  const fontFamily = style?.fontFamily ?? 'inherit';
  const fontWeight = style?.fontWeight ?? (isTitle ? 800 : 600);

  const patchStyle = (patch: Partial<NonNullable<Slide['titleTextStyle']>>) => {
    if (isTitle) {
      onUpdate({ titleTextStyle: { ...slide.titleTextStyle, ...patch } });
    } else {
      onUpdate({ bodyTextStyle: { ...slide.bodyTextStyle, ...patch } });
    }
  };

  const adjustSize = (delta: number) => {
    patchStyle({ fontSize: Math.min(96, Math.max(12, fontSize + delta)) });
  };

  return (
    <div className="space-y-3">
      <textarea
        value={textValue}
        onChange={(e) => {
          if (isTitle) {
            onUpdate({ title: e.target.value });
          } else {
            onUpdate({ body: e.target.value, content: e.target.value });
          }
        }}
        rows={isTitle ? 3 : 4}
        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#8b5cf6]"
        placeholder={isTitle ? '제목을 입력하세요…' : '본문을 입력하세요…'}
      />

      {/* Font */}
      <div>
        <p className="text-[11px] font-black text-slate-500 mb-1">폰트</p>
        <select
          value={fontFamily}
          onChange={(e) => patchStyle({ fontFamily: e.target.value })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-[#8b5cf6]"
        >
          {SLIDE_FONT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Size */}
      <div>
        <p className="text-[11px] font-black text-slate-500 mb-1">크기</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => adjustSize(-2)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-center text-sm font-black text-slate-700">
            {Math.round(fontSize)}
          </div>
          <button
            type="button"
            onClick={() => adjustSize(2)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {SLIDE_SIZE_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => patchStyle({ fontSize: s })}
              className={cn(
                'rounded-md border px-1.5 py-0.5 text-xs font-black transition-all',
                Math.round(fontSize) === s
                  ? 'border-[#8b5cf6] bg-[#ede9fe] text-[#6d28d9]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
      <div>
        <p className="text-[11px] font-black text-slate-500 mb-1">색상</p>
        <ColorSwatch value={color} onChange={(v) => patchStyle({ color: v })} />
      </div>

      {/* Weight */}
      <div>
        <p className="text-[11px] font-black text-slate-500 mb-1">굵기</p>
        <div className="grid grid-cols-5 gap-1.5">
          {SLIDE_WEIGHT_OPTIONS.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => patchStyle({ fontWeight: w.value })}
              className={cn(
                'rounded-lg border py-1.5 text-xs font-black transition-all',
                fontWeight === w.value
                  ? 'border-[#8b5cf6] bg-[#8b5cf6] text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main SlideEditor ──────────────────────────────────────────────────────────

export interface SlideEditorProps {
  /** Controlled: 외부에서 슬라이드 배열을 관리합니다. */
  slides: Slide[];
  onSlidesChange: (slides: Slide[]) => void;
  aspectRatio: string;
  caption?: string;
  accountName?: string;
  accountLocation?: string;
  /** 선택된 슬라이드 인덱스 (controlled). 제공하지 않으면 내부 상태 사용. */
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
}

export function SlideEditor({
  slides,
  onSlidesChange,
  aspectRatio,
  caption,
  accountName,
  accountLocation,
  selectedIndex: externalSelectedIndex,
  onSelectIndex,
}: SlideEditorProps) {
  const [internalSelectedIndex, setInternalSelectedIndex] = useState<number | null>(null);

  const isSelectionControlled = externalSelectedIndex !== undefined;
  const selectedIndex = isSelectionControlled
    ? externalSelectedIndex
    : internalSelectedIndex;

  const handleSelectIndex = (idx: number) => {
    if (!isSelectionControlled) {
      setInternalSelectedIndex((prev) => (prev === idx ? null : idx));
    }
    onSelectIndex?.(idx);
  };

  const updateSlide = (index: number, patch: Partial<Slide>) => {
    onSlidesChange(slides.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const [openSection, setOpenSection] = useState<AccordionSection>('title');

  const sel = selectedIndex !== null && selectedIndex !== undefined ? slides[selectedIndex] : null;
  const isCover = selectedIndex === 0;
  const imageUrl = (sel?.image || sel?.renderedImageUrl || '').trim();

  return (
    <div className="flex gap-5 items-start w-full min-h-0">
      {/* ── 왼쪽: 캐러셀 미리보기 + 썸네일 ── */}
      <div className="flex flex-col gap-3 w-[400px] flex-shrink-0">
        <CarouselPreview
          slides={slides}
          aspectRatio={aspectRatio}
          caption={caption}
          accountName={accountName}
          accountLocation={accountLocation}
        />

        <div className="flex gap-2 overflow-x-auto pb-1 max-w-[400px]">
          {slides.map((slide, i) => (
            <SlideThumbnail
              key={slide.id ?? i}
              slide={slide}
              index={i}
              selected={selectedIndex === i}
              onClick={() => handleSelectIndex(i)}
            />
          ))}
        </div>
        <p className="text-[11px] text-slate-400 text-center -mt-1">
          슬라이드를 클릭해 편집하세요
        </p>
      </div>

      {/* ── 오른쪽: 편집 패널 ── */}
      {sel !== null && sel !== undefined && selectedIndex !== null && selectedIndex !== undefined && (
        <div className="w-[360px] flex-shrink-0 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden self-start">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#8b5cf6] text-white text-[10px] font-bold">
                {selectedIndex + 1}
              </span>
              <span className="text-sm font-semibold text-slate-700">
                {(sel.title || `슬라이드 ${selectedIndex + 1}`).slice(0, 20)}
              </span>
            </div>
            {!isSelectionControlled && (
              <button
                type="button"
                onClick={() => setInternalSelectedIndex(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors rounded-lg p-0.5 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="overflow-y-auto max-h-[72vh] divide-y divide-slate-100">

            {/* ── 배경 이미지 ── */}
            <div className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenSection((p) => p === 'background' ? 'title' : 'background')}
                className="flex w-full items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-black text-slate-800">배경 이미지</span>
                </div>
                <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', openSection === 'background' && 'rotate-180')} />
              </button>
              {openSection === 'background' && (
                <div className="px-4 pb-4 space-y-2 border-t border-slate-100">
                  <div className="flex gap-2 mt-2">
                    <input
                      type="url"
                      value={sel.image ?? ''}
                      onChange={(e) => updateSlide(selectedIndex, { image: e.target.value })}
                      placeholder="https://..."
                      className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-[#8b5cf6]"
                    />
                    <button
                      type="button"
                      onClick={() => updateSlide(selectedIndex, { image: '' })}
                      disabled={!imageUrl}
                      className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </div>
                  <input
                    type="text"
                    value={sel.keywords ?? ''}
                    onChange={(e) => updateSlide(selectedIndex, { keywords: e.target.value })}
                    placeholder="이미지 검색 키워드"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-[#8b5cf6]"
                  />
                  {imageUrl && (
                    <div className="rounded-xl overflow-hidden aspect-[4/5] bg-slate-100">
                      <img
                        src={imageUrl}
                        alt="배경 미리보기"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── 제목 텍스트 ── */}
            <div className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenSection((p) => p === 'title' ? 'body' : 'title')}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 bg-[#faf8ff]"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 text-xs font-black">T</span>
                  <span className="text-sm font-black text-slate-800 truncate max-w-[200px]">
                    {(sel.title || '슬라이드 제목')}
                  </span>
                </div>
                <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform flex-shrink-0', openSection === 'title' && 'rotate-180')} />
              </button>
              {openSection === 'title' && (
                <div className="px-4 pb-4 pt-3 border-t border-slate-100">
                  <LayerStylePanel
                    layer="title"
                    slide={sel}
                    isCover={isCover}
                    onUpdate={(patch) => updateSlide(selectedIndex, patch)}
                  />
                </div>
              )}
            </div>

            {/* ── 본문 텍스트 ── */}
            <div className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenSection((p) => p === 'body' ? 'title' : 'body')}
                className="flex w-full items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 text-xs font-black">B</span>
                  <span className="text-sm font-black text-slate-800 truncate max-w-[200px]">
                    {(sel.body || sel.content || '본문 문구')}
                  </span>
                </div>
                <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform flex-shrink-0', openSection === 'body' && 'rotate-180')} />
              </button>
              {openSection === 'body' && (
                <div className="px-4 pb-4 pt-3 border-t border-slate-100">
                  <LayerStylePanel
                    layer="body"
                    slide={sel}
                    isCover={isCover}
                    onUpdate={(patch) => updateSlide(selectedIndex, patch)}
                  />
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
