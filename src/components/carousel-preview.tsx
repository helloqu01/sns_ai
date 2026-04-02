"use client";

import React, { useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal } from 'lucide-react';
import 'swiper/css';
import 'swiper/css/pagination';

export interface Slide {
    id?: string;
    title: string;
    content?: string;
    body?: string;
    keywords?: string;
    image?: string;
    renderedImageUrl?: string;
    textPosition?: "top" | "center" | "bottom";
    textOffsetX?: number;
    textOffsetY?: number;
    titleOffsetX?: number;
    titleOffsetY?: number;
    bodyOffsetX?: number;
    bodyOffsetY?: number;
    titleTextStyle?: {
        fontFamily?: string;
        fontSize?: number;
        color?: string;
        fontWeight?: number;
    };
    bodyTextStyle?: {
        fontFamily?: string;
        fontSize?: number;
        color?: string;
        fontWeight?: number;
    };
}

interface CarouselPreviewProps {
    slides: Slide[];
    aspectRatio: string;
    caption?: string;
    accountName?: string;
    accountLocation?: string;
}

const normalizeAccountName = (value?: string) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return 'queens_smile_official';
    return trimmed.replace(/^@/, '');
};

const toAvatarInitial = (accountName: string) => {
    const stripped = accountName.replace(/[\s._-]+/g, '');
    if (!stripped) return 'IG';
    return stripped.slice(0, 2).toUpperCase();
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const asFiniteNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const getSlideTextOffset = (slide: Slide, index: number) => {
    const fallbackY = slide.textPosition === "top"
        ? 24
        : slide.textPosition === "bottom"
            ? 78
            : index === 0
                ? 78
                : 50;

    return {
        x: typeof slide.textOffsetX === "number" ? clamp(slide.textOffsetX, 8, 92) : 38,
        y: typeof slide.textOffsetY === "number" ? clamp(slide.textOffsetY, 10, 90) : fallbackY,
    };
};

const resolveLayerOffset = (slide: Slide, index: number, layer: "title" | "body") => {
    const base = getSlideTextOffset(slide, index);
    if (layer === "title") {
        return {
            x: typeof slide.titleOffsetX === "number" ? clamp(slide.titleOffsetX, 8, 92) : base.x,
            y: typeof slide.titleOffsetY === "number" ? clamp(slide.titleOffsetY, 10, 90) : base.y,
        };
    }
    return {
        x: typeof slide.bodyOffsetX === "number" ? clamp(slide.bodyOffsetX, 8, 92) : base.x,
        y: typeof slide.bodyOffsetY === "number" ? clamp(slide.bodyOffsetY, 10, 90) : clamp(base.y + 16, 10, 90),
    };
};

const resolveTextStyle = (
    slide: Slide,
    layer: "title" | "body",
    isCoverSlide: boolean,
) => {
    const fallback = layer === "title"
        ? {
            fontFamily: "inherit",
            fontSize: isCoverSlide ? 54 : 40,
            color: "#ffffff",
            fontWeight: 800,
        }
        : {
            fontFamily: "inherit",
            fontSize: isCoverSlide ? 30 : 28,
            color: "#f8fafc",
            fontWeight: 600,
        };

    const source = layer === "title" ? slide.titleTextStyle : slide.bodyTextStyle;
    const fontSize = asFiniteNumber(source?.fontSize);
    const fontWeight = asFiniteNumber(source?.fontWeight);
    const color = typeof source?.color === "string" && source.color.trim().length > 0 ? source.color.trim() : fallback.color;
    const fontFamily = typeof source?.fontFamily === "string" && source.fontFamily.trim().length > 0
        ? source.fontFamily.trim()
        : fallback.fontFamily;

    return {
        fontFamily,
        fontSize: fontSize !== null ? clamp(fontSize, 12, 96) : fallback.fontSize,
        color,
        fontWeight: fontWeight !== null ? clamp(fontWeight, 100, 900) : fallback.fontWeight,
    };
};

export function CarouselPreview({
    slides,
    aspectRatio,
    caption = '',
    accountName,
    accountLocation,
}: CarouselPreviewProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const displayAccountName = normalizeAccountName(accountName);
    const displayAccountLocation = (accountLocation || '').trim() || '대한민국 어딘가';
    const avatarInitial = toAvatarInitial(displayAccountName);

    const getRatioClass = () => {
        switch (aspectRatio) {
            case '1:1': return 'aspect-square';
            case '16:9': return 'aspect-video';
            case '9:16': return 'aspect-[9/16]';
            case '3:4': return 'aspect-[3/4]';
            default: return 'aspect-[4/5]';
        }
    };

    const renderCaption = (text: string) => {
        if (!text) return null;
        const parts = text.split(/(#[^\s#]+)/g);
        return parts.map((part, i) => {
            if (part.startsWith('#')) {
                return (
                    <span key={i} className="text-[#00376b] hover:underline cursor-pointer">
                        {part}
                    </span>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    return (
        <div className="w-full max-w-[400px] mx-auto break-keep overflow-hidden rounded-[2rem] border border-slate-200 bg-white font-sans shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-100/60 bg-white">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-yellow-400 via-[#e95950] to-[#bc2a8d] p-[2px]">
                            <div className="w-full h-full bg-white rounded-full border-2 border-white overflow-hidden flex items-center justify-center font-bold text-pink-600 text-xs">
                                {avatarInitial}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col">
                        <span className="mb-0.5 text-[13px] font-semibold leading-none tracking-tight text-slate-900">{displayAccountName}</span>
                        <span className="break-keep text-[11px] leading-none text-slate-500">{displayAccountLocation}</span>
                    </div>
                </div>
                <button className="text-slate-900 hover:opacity-60 transition-opacity">
                    <MoreHorizontal className="w-5 h-5" />
                </button>
            </div>

            {/* Slides (Swiper) */}
            <Swiper
                modules={[Pagination]}
                spaceBetween={0}
                slidesPerView={1}
                pagination={{
                    clickable: true,
                    el: '.custom-swiper-pagination',
                    bulletClass: 'swiper-custom-bullet',
                    bulletActiveClass: 'swiper-custom-bullet-active',
                }}
                className={`w-full bg-slate-100 ${getRatioClass()}`}
            >
                {slides.map((slide, index) => {
                    const titleText = (slide.title || `슬라이드 ${index + 1}`).trim();
                    const bodyText = (slide.body || slide.content || '').trim();
                    const isCoverSlide = index === 0;
                    const slideImageUrl = (slide.image || slide.renderedImageUrl || '').trim();
                    const titleOffset = resolveLayerOffset(slide, index, "title");
                    const bodyOffset = resolveLayerOffset(slide, index, "body");
                    const titleStyle = resolveTextStyle(slide, "title", isCoverSlide);
                    const bodyStyle = resolveTextStyle(slide, "body", isCoverSlide);

                    return (
                    <SwiperSlide key={slide.id || index}>
                        <div className="relative w-full h-full bg-slate-900 overflow-hidden p-6 sm:p-8 text-white">
                            {slideImageUrl ? (
                                <>
                                    <img
                                        src={slideImageUrl}
                                        alt=""
                                        className="absolute inset-0 w-full h-full object-cover"
                                    />
                                </>
                            ) : (
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(244,114,182,0.55),transparent_44%),radial-gradient(circle_at_85%_14%,rgba(96,165,250,0.45),transparent_42%),linear-gradient(150deg,#0f172a_0%,#1e293b_55%,#334155_100%)]" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-black/75" />

                            <div
                                className="absolute z-10 w-[88%] max-w-[88%]"
                                style={{
                                    left: `${titleOffset.x}%`,
                                    top: `${titleOffset.y}%`,
                                    transform: "translate(-50%, -50%)",
                                }}
                            >
                                <h2
                                    className={isCoverSlide
                                        ? "whitespace-pre-wrap break-keep leading-[1.14] tracking-[-0.02em] drop-shadow-[0_6px_24px_rgba(2,6,23,0.55)]"
                                        : "whitespace-pre-wrap break-keep rounded-xl border border-white/25 bg-black/30 px-4 py-3 leading-tight drop-shadow-md"}
                                    style={{
                                        fontFamily: titleStyle.fontFamily === "inherit" ? undefined : titleStyle.fontFamily,
                                        fontSize: `${titleStyle.fontSize}px`,
                                        color: titleStyle.color,
                                        fontWeight: titleStyle.fontWeight,
                                    }}
                                >
                                    {titleText}
                                </h2>
                            </div>
                            {bodyText ? (
                                <div
                                    className="absolute z-10 w-[86%] max-w-[86%]"
                                    style={{
                                        left: `${bodyOffset.x}%`,
                                        top: `${bodyOffset.y}%`,
                                        transform: "translate(-50%, -50%)",
                                    }}
                                >
                                    <p
                                        className="whitespace-pre-wrap break-keep leading-relaxed drop-shadow-sm"
                                        style={{
                                            fontFamily: bodyStyle.fontFamily === "inherit" ? undefined : bodyStyle.fontFamily,
                                            fontSize: `${bodyStyle.fontSize}px`,
                                            color: bodyStyle.color,
                                            fontWeight: bodyStyle.fontWeight,
                                        }}
                                    >
                                        {bodyText}
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    </SwiperSlide>
                )})}
            </Swiper>

            {/* Action Bar & Caption */}
            <div className="px-3.5 flex flex-col bg-white pb-4">
                {/* Actions Icons + Custom Pagination Dots */}
                <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3.5">
                        <button className="hover:opacity-60 transition-opacity"><Heart className="w-6 h-6 stroke-[1.5]" /></button>
                        <button className="hover:opacity-60 transition-opacity"><MessageCircle className="w-6 h-6 stroke-[1.5]" /></button>
                        <button className="hover:opacity-60 transition-opacity"><Send className="w-6 h-6 stroke-[1.5] -mt-1 -ml-0.5 transform rotate-12" /></button>
                    </div>
                    {/* The Swiper Pagination will bind to this div */}
                    <div className="custom-swiper-pagination flex items-center justify-center gap-1.5 flex-1"></div>
                    <div className="flex items-center">
                        <button className="hover:opacity-60 transition-opacity"><Bookmark className="w-6 h-6 stroke-[1.5]" /></button>
                    </div>
                </div>

                {/* Likes Placeholder */}
                <div className="text-[13px] font-semibold text-slate-900 mb-1.5">
                    좋아요 1,234개
                </div>

                {/* Live Caption Text */}
                <div className="break-keep whitespace-pre-wrap text-[13px] leading-[1.4] tracking-tight text-slate-900">
                    <span className="mr-1.5 whitespace-nowrap font-semibold align-top">{displayAccountName}</span>
                    <span className={isExpanded ? "" : "line-clamp-2"}>
                        {renderCaption(caption)}
                    </span>
                    {!isExpanded && caption && caption.length > 50 && (
                        <button
                            onClick={() => setIsExpanded(true)}
                            className="text-slate-500 font-medium hover:text-slate-700 mt-0.5 block"
                        >
                            더 보기
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
