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
    image?: string;
    renderedImageUrl?: string;
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
        <div className="w-full max-w-[400px] mx-auto bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden font-sans">
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
                        <span className="text-[13px] font-semibold text-slate-900 leading-none mb-0.5 tracking-tight">{displayAccountName}</span>
                        <span className="text-[11px] text-slate-500 leading-none">{displayAccountLocation}</span>
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

                    return (
                    <SwiperSlide key={slide.id || index}>
                        <div className="relative w-full h-full bg-slate-900 overflow-hidden p-6 sm:p-8 text-white">
                            {slide.image ? (
                                <>
                                    <img
                                        src={slide.image}
                                        alt=""
                                        className="absolute inset-0 w-full h-full object-cover opacity-60"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/40 to-black/80" />
                                </>
                            ) : (
                                <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-indigo-800" />
                            )}

                            <div className="relative z-10 w-full h-full flex flex-col">
                                {isCoverSlide ? (
                                    <div className="mt-auto max-w-[88%] pb-1">
                                        <h2 className="text-[34px] font-black leading-[1.14] tracking-[-0.02em] text-white drop-shadow-[0_6px_24px_rgba(2,6,23,0.55)]">
                                            {titleText}
                                        </h2>
                                    </div>
                                ) : (
                                    <>
                                        <div className="mb-3 inline-flex w-fit rounded-full border border-white/35 bg-black/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/90 backdrop-blur-sm">
                                            Slide {index + 1}
                                        </div>
                                        <h2 className="rounded-xl border border-white/25 bg-black/30 px-4 py-3 text-xl font-black leading-tight drop-shadow-md">
                                            {titleText}
                                        </h2>
                                        {bodyText ? (
                                            <p className="mt-4 text-base opacity-95 whitespace-pre-wrap leading-relaxed drop-shadow-sm">
                                                {bodyText}
                                            </p>
                                        ) : null}
                                    </>
                                )}
                            </div>
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
                <div className="text-[13px] text-slate-900 leading-[1.4] tracking-tight whitespace-pre-wrap">
                    <span className="font-semibold mr-1.5 align-top">{displayAccountName}</span>
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
