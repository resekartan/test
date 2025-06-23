mapboxgl.accessToken = 'pk.eyJ1IjoicmVzZWthcnRhbiIsImEiOiJjbTg5bmpxcHoweWRuMmtxdTNlcnd5OHAxIn0.yaoMOnbViUMe8gP_Y8w0ow';

const isMobile = window.innerWidth <= 768;
const initialZoom = isMobile ? 2 : 2.5;
const initialCenter = [45, 25];

// Get URL parameters before initializing the map
const urlParams = getUrlParameters();

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    center: urlParams ? [urlParams.lng, urlParams.lat] : initialCenter,
    zoom: urlParams ? urlParams.zoom : initialZoom,
    projection: 'globe',
    maxBounds: [
        [-180, -85],
        [180, 85]
    ],
    preserveDrawingBuffer: false,
    fadeDuration: 0,
    crossSourceCollisions: false,
    renderWorldCopies: true,
    antialias: true,
    maxZoom: 17,
    minZoom: isMobile ? 1 : 1.5,
    keyboard: true,
    touchZoomRotate: true,
    attributionControl: false,
    trackResize: true
});

if (map.getSource('custom-data')) {
    map.setLayerZoomRange('custom-data', 2, 17);
}

function debounce(func, wait) {
    let timeout;

    const debouncedFunction = function(...args) {
        if (timeout) {
            clearTimeout(timeout);
        }

        timeout = setTimeout(() => {
            func.apply(this, args);
            timeout = null;
        }, wait);
    };

    debouncedFunction.cancel = function() {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
    };

    return debouncedFunction;
}

const searchContainer = document.getElementById('search-container');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const searchResults = document.getElementById('search-results');
const searchMarker = new mapboxgl.Marker({
    color: '#00b4ff',
    scale: 0.8
});

let measurementActive = false;
let points = [];
let measureButton = null;
let isDrawingLine = false;
let measurementLocked = false;
let currentPopup = null;
let searchTimeout = null;
let currentFeatures = [];
let attractionsData = null;
let searchIndex = null;
let fuseIndex;
let lastTap = 0;
let touchTimeout;
let touchStartPos;
let activeMapStyle = 'mapbox://styles/mapbox/outdoors-v12';
let isTouchScrolling = false;
let startCoords = null;
let endCoords = null;
let isTouchEvent = false;
let selectedFeature = null;
let touchStartY;
let bufferUpdateTimeout;
let layerVisibility = {};

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.innerHTML = text;
    const decodedText = div.textContent || div.innerText;
    return decodedText;
}

function isAttractionSaved(name) {
    const savedAttractions = JSON.parse(localStorage.getItem("titelSave") || "[]");
    for (let i = 0; i < savedAttractions.length; i += 3) {
        if (savedAttractions[i] === name) {
            return true;
        }
    }
    return false;
}

function initializeInputScrolling() {
    const startInput = document.getElementById('start-point');
    const endInput = document.getElementById('end-point');
    const container = document.querySelector('.explore-route-container');

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            if (window.visualViewport.height < window.innerHeight) {
                document.body.classList.add('keyboard-visible');
                const keyboardHeight = window.innerHeight - window.visualViewport.height;
                container.style.bottom = `${keyboardHeight}px`;
            } else {
                document.body.classList.remove('keyboard-visible');
                container.style.bottom = '0';
            }
        });
    }

    [startInput, endInput].forEach(input => {
        input.addEventListener('focus', () => {
            map.scrollZoom.disable();
        });

        input.addEventListener('blur', () => {
            map.scrollZoom.enable();
        });
    });
}

function getPopupContent(feature, coordinates, isLine = false) {
    const name = escapeHtml(feature.properties.Name || 'N/A');
    const description = escapeHtml(feature.properties.Description || '');
    const isSaved = isAttractionSaved(name);
    const encodedName = encodeURIComponent(feature.properties.Name || 'N/A');

    var html = [
        `<div class="popup-title">${name}</div>`,
        `<div class="popup-description">${description}</div>`,
        '<div class="popup-actions">'
    ];

    if (!isLine) {
        html.push(`<button class="popup-action-btn navigate" data-coords="${coordinates}">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="white"/></svg>
            Navigate</button>`);

        html.push(`<button class="popup-action-btn save" data-name="${encodedName}">
            ${isSaved ?
                '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="#FF5722"/></svg>' :
                '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" fill="#FF5722"/></svg>'}
            Save</button>`);
    }

    html.push(`<button class="popup-action-btn images" data-name="${encodedName}">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" fill="white"/></svg>
        Images</button>`);

    html.push(`<button class="popup-action-btn search" data-name="${encodedName}">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="white"/></svg>
        Info</button>`);

    html.push('</div>');
    return html.join('');
}

function updateSaveState(name) {
    saveAttraction(name);

    const popupSaveBtn = document.querySelector('.popup-container .popup-action-btn');
    if (popupSaveBtn) {
        popupSaveBtn.style.color = isAttractionSaved(name) ? '#FF5722' : '';
    }

    const routeListingEl = document.getElementById('route-attractions-listing');
    if (routeListingEl) {
        const listItems = routeListingEl.querySelectorAll('.listing-item-container');
        listItems.forEach(item => {
            const nameElement = item.querySelector('.listing-item');
            if (nameElement && nameElement.textContent === name) {
                const saveIcon = item.querySelector('.save-icon');
                if (saveIcon) {
                    saveIcon.innerHTML = isAttractionSaved(name) ?
                        '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="#FF5722"/></svg>' :
                        '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z"/></svg>';
                }
            }
        });
    }
}

map.on('load', () => {
    console.log('Map loaded, initializing controls...');
    initializeStyleSelector();

    map.setFog({
        'color': 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6
    });

    const isDesktop = window.matchMedia('(min-width: 768px) and (pointer: fine)').matches;
    let rotationInterval = null;

    const startRotation = () => {
        if (!isDesktop || rotationInterval || window.urlParams) return; // Kontrollera urlParams

        rotationInterval = window.setInterval(() => {
            if (!map.isMoving() && !map.isZooming()) {
                const center = map.getCenter();
                let newLng = center.lng - 0.07;
                if (newLng < -180) {
                    newLng = 180;
                }
                map.setCenter([newLng, center.lat]);
            }
        }, 50);
    };

    const stopRotation = () => {
        if (rotationInterval) {
            window.clearInterval(rotationInterval);
            rotationInterval = null;
        }
    };

    // Only start rotation if there are no URL parameters
    if (isDesktop && !urlParams) {
        startRotation();
    }

    [
        'mousedown',
        'touchstart',
        'dragstart',
        'pitchstart',
        'rotatestart',
        'wheel',
        'scrollstart'
    ].forEach(event => {
        map.on(event, stopRotation);
    });

    document.querySelector('.menu-toggle')?.addEventListener('click', stopRotation);

    map.addControl(new mapboxgl.NavigationControl({
        showCompass: true,
        showZoom: false,
        eventHandlerOptions: {
            passive: true
        }
    }), 'top-left');

    const geolocate = new mapboxgl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true,
        showUserLocation: true,
        showUserHeading: true
    });
    map.addControl(geolocate, 'top-left');

    if (isDesktop) {
        geolocate.on('geolocate', stopRotation);
    }

    const measureControl = document.createElement('div');
    measureControl.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    measureButton = document.createElement('button');
    measureButton.className = 'mapbox-gl-draw_line';
    measureButton.title = 'Draw Line';
    measureControl.appendChild(measureButton);
    document.querySelector('.mapboxgl-ctrl-top-left').appendChild(measureControl);
    measureButton.addEventListener('click', () => {
        if (isDesktop) stopRotation();
        toggleMeasurement();
    });

    initializeSearch();
	loadSharedRoute();

    window.matchMedia('(min-width: 768px) and (pointer: fine)').addEventListener('change', (e) => {
        if (e.matches && !urlParams) {
            startRotation();
        } else {
            stopRotation();
        }
    });
});

map.on('style.load', () => {
	console.log('Style loaded, adding source and layers...');

	const currentStyle = map.getStyle().sprite;
	const styleCircles = document.querySelectorAll('.style-circle');

	[
		['custom-data', {
			type: 'vector',
			url: 'mapbox://resekartan.cm1mwsfmz0ssz1mmxjutycoso-2uzy7'
		}],
		['measure-line', {
			type: 'geojson',
			data: {
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: []
				}
			}
		}],
		['measure-points', {
			type: 'geojson',
			data: {
				type: 'FeatureCollection',
				features: []
			}
		}],
		['route-buffer', {
			type: 'geojson',
			data: {
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: []
				}
			}
		}]
	].forEach(([id, source]) => {
		if (!map.getSource(id)) {
			map.addSource(id, source);
		}
	});

	const markerLayers = [{
			id: 'green_markers',
			color: '#4CAF50',
			filter: ['==', ['get', 'Filter'], '1']
		},
		{
			id: 'yellow_markers',
			color: '#FFC107',
			filter: ['==', ['get', 'Filter'], '2']
		},
		{
			id: 'red_markers',
			color: '#f44336',
			filter: ['==', ['get', 'Filter'], '4']
		},
		{
			id: 'darkred_markers',
			color: '#b71c1c',
			filter: ['==', ['get', 'Filter'], '5']
		},
		{
			id: 'grey_markers',
			color: '#9E9E9E',
			filter: ['==', ['get', 'Filter'], '6']
		},
		{
			id: 'white_markers',
			color: '#FFFFFF',
			filter: ['==', ['get', 'Filter'], '7'],
			strokeColor: '#9E9E9E'
		}
	];

	const symbolLayers = [{
			id: 'restaurant_markers',
			icon: 'restaurant-icon',
			filter: ['==', ['get', 'Filter'], '11']
		},
		{
			id: 'nightlife_markers',
			icon: 'nightlife-icon',
			filter: ['==', ['get', 'Filter'], '10']
		},
		{
			id: 'accommodation_markers',
			icon: 'lodging-icon',
			filter: ['==', ['get', 'Filter'], '9']
		}
	];

	symbolLayers.forEach(layer => {
		if (!map.getLayer(layer.id)) {
			const svgIcon = layer.id === 'restaurant_markers' ?
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
				'<circle cx="12" cy="12" r="12" fill="#003366"/>' +
				'<path transform="translate(4.5,4.5)" fill="white" d="M3.5,0l-1,5.5c-0.1464,0.805,1.7815,1.181,1.75,2L4,14c-0.0384,0.9993,1,1,1,1s1.0384-0.0007,1-1L5.75,7.5c-0.0314-0.8176,1.7334-1.1808,1.75-2L6.5,0H6l0.25,4L5.5,4.5L5.25,0h-0.5L4.5,4.5L3.75,4L4,0H3.5z M12,0c-0.7364,0-1.9642,0.6549-2.4551,1.6367C9.1358,2.3731,9,4.0182,9,5v2.5c0,0.8182,1.0909,1,1.5,1L10,14c-0.0905,0.9959,1,1,1,1s1,0,1-1V0z"/></svg>' :
				layer.id === 'nightlife_markers' ?
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
				'<circle cx="12" cy="12" r="12" fill="#003366"/>' +
				'<path transform="translate(4.5,4.5)" fill="white" d="M14,4h-4v3.44c0.003,0.9096,0.6193,1.7026,1.5,1.93V13H11c-0.2761,0-0.5,0.2239-0.5,0.5S10.7239,14,11,14h2c0.2761,0,0.5-0.2239,0.5-0.5S13.2761,13,13,13h-0.5V9.43c0.8807-0.2274,1.497-1.0204,1.5-1.93V4z M13,7.5c0,0.5523-0.4477,1-1,1s-1-0.4477-1-1V5h2V7.5z M5.5,2.5V2C5.7761,2,6,1.7761,6,1.5S5.7761,1,5.5,1V0.5C5.5,0.2239,5.2761,0,5,0H4C3.7239,0,3.5,0.2239,3.5,0.5V1C3.2239,1,3,1.2239,3,1.5S3.2239,2,3.5,2v0.5C3.5,3.93,1,5.57,1,7v6c0,0.5523,0.4477,1,1,1h5c0.5318-0.0465,0.9535-0.4682,1-1V7C8,5.65,5.5,3.85,5.5,2.5z M4.5,12C3.1193,12,2,10.8807,2,9.5S3.1193,7,4.5,7S7,8.1193,7,9.5S5.8807,12,4.5,12z"/></svg>' :
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
				'<circle cx="12" cy="12" r="12" fill="#003366"/>' +
				'<path transform="translate(4.5,4.5)" fill="white" d="M0.5,2.5C0.2,2.5,0,2.7,0,3v7.5v2C0,12.8,0.2,13,0.5,13S1,12.8,1,12.5V11h13v1.5c0,0.3,0.2,0.5,0.5,0.5s0.5-0.2,0.5-0.5v-2c0-0.3-0.2-0.5-0.5-0.5H1V3C1,2.7,0.8,2.5,0.5,2.5z M3.5,3C2.7,3,2,3.7,2,4.5C2,5.3,2.7,6,3.5,6C4.3,6,5,5.3,5,4.5C5,3.7,4.3,3,3.5,3z M7,4C5.5,4,5.5,5.5,5.5,5.5V7h-3C2.2,7,2,7.2,2,7.5v1C2,8.8,2.2,9,2.5,9H6h9V6.5C15,4,12.5,4,12.5,4H7z"/></svg>';

			map.addLayer({
				'id': layer.id,
				'type': 'symbol',
				'source': 'custom-data',
				'source-layer': 'tileset_resekartan',
				'filter': layer.filter,
				'layout': {
					'icon-image': [
						'case',
						['==', ['get', 'Filter'], '11'], 'restaurant-icon',
						['==', ['get', 'Filter'], '10'], 'nightlife-icon',
						'lodging-icon'
					],
					'icon-size': [
						'interpolate',
						['linear'],
						['zoom'],
						2, 0.2,
						4, 0.4,
						6, 0.5,
						8, 0.6,
						13, 0.7,
						15, 0.8
					],
					'icon-allow-overlap': true
				}
			});

			if (!map.hasImage('restaurant-icon') && layer.id === 'restaurant_markers') {
				const img = new Image();
				img.onload = () => map.addImage('restaurant-icon', img);
				img.src = 'data:image/svg+xml;base64,' + btoa(svgIcon);
			}
			if (!map.hasImage('nightlife-icon') && layer.id === 'nightlife_markers') {
				const img = new Image();
				img.onload = () => map.addImage('nightlife-icon', img);
				img.src = 'data:image/svg+xml;base64,' + btoa(svgIcon);
			}
			if (!map.hasImage('lodging-icon') && layer.id === 'accommodation_markers') {
				const img = new Image();
				img.onload = () => map.addImage('lodging-icon', img);
				img.src = 'data:image/svg+xml;base64,' + btoa(svgIcon);
			}
		}

		if (!map.getLayer(`${layer.id}_click`)) {
			map.addLayer({
				'id': `${layer.id}_click`,
				'type': 'circle',
				'source': 'custom-data',
				'source-layer': 'tileset_resekartan',
				'filter': layer.filter,
				'paint': {
					'circle-radius': 16,
					'circle-color': 'transparent',
					'circle-stroke-width': 0
				}
			});
		}
	});

	const lineLayers = [{
			id: 'line_yellow_markers',
			color: '#FFC107',
			filter: ['==', ['get', 'Filter'], '12']
		},
		{
			id: 'line_red_markers',
			color: '#f44336',
			filter: ['==', ['get', 'Filter'], '13']
		},
		{
			id: 'line_grey_markers',
			color: '#9E9E9E',
			filter: ['==', ['get', 'Filter'], '14']
		}
	];

	lineLayers.forEach(layer => {
		if (!map.getLayer(layer.id)) {
			map.addLayer({
				'id': layer.id,
				'type': 'line',
				'source': 'custom-data',
				'source-layer': 'tileset_resekartan',
				'filter': layer.filter,
				'layout': {
					'line-join': 'round',
					'line-cap': 'round'
				},
				'paint': {
					'line-color': layer.color,
					'line-width': [
						'interpolate',
						['linear'],
						['zoom'],
						2, 3,
						3, 4,
						10, 5,
						15, 6
					]
				}
			});
		}

		if (!map.getLayer(`${layer.id}_click`)) {
			map.addLayer({
				'id': `${layer.id}_click`,
				'type': 'line',
				'source': 'custom-data',
				'source-layer': 'tileset_resekartan',
				'filter': layer.filter,
				'layout': {
					'line-join': 'round',
					'line-cap': 'round',
					'visibility': 'visible'
				},
				'paint': {
					'line-color': 'transparent',
					'line-width': 20
				}
			});
		}
	});

	markerLayers.forEach(layer => {
		if (!map.getLayer(layer.id)) {
			map.addLayer({
				'id': layer.id,
				'type': 'circle',
				'source': 'custom-data',
				'source-layer': 'tileset_resekartan',
				'filter': layer.filter,
				'paint': {
					'circle-radius': [
						'interpolate',
						['linear'],
						['zoom'],
						2, 3,
						4, 5,
						8, 6,
						15, 7
					],
					'circle-color': layer.color,
					'circle-stroke-width': 1,
					'circle-stroke-color': layer.strokeColor || '#ffffff'
				}
			});
		}

		if (!map.getLayer(`${layer.id}_click`)) {
			map.addLayer({
				'id': `${layer.id}_click`,
				'type': 'circle',
				'source': 'custom-data',
				'source-layer': 'tileset_resekartan',
				'filter': layer.filter,
				'paint': {
					'circle-radius': 16,
					'circle-color': 'transparent',
					'circle-stroke-width': 0
				}
			});
		}
	});

	['route-buffer', 'measure-line', 'measure-points'].forEach(layerId => {
		if (map.getLayer(layerId)) map.removeLayer(layerId);
	});

	map.addLayer({
		'id': 'route-buffer',
		'type': 'fill',
		'source': 'route-buffer',
		'layout': {},
		'paint': {
			'fill-color': '#d222d2',
			'fill-opacity': 0.3
		}
	});

	map.addLayer({
		'id': 'measure-line',
		'type': 'line',
		'source': 'measure-line',
		'paint': {
			'line-color': '#003366',
			'line-width': 6,
			'line-opacity': 0.8
		}
	});

	map.addLayer({
		'id': 'measure-points',
		'type': 'circle',
		'source': 'measure-points',
		'paint': {
			'circle-radius': 5,
			'circle-color': '#002347'
		}
	});
});

function addClickablePointsAndLines() {
	const markerLayerIds = [
		'yellow_markers', 'yellow_markers_click',
		'green_markers', 'green_markers_click',
		'red_markers', 'red_markers_click',
		'darkred_markers', 'darkred_markers_click',
		'grey_markers', 'grey_markers_click',
		'white_markers', 'white_markers_click',
		'accommodation_markers', 'accommodation_markers_click',
		'nightlife_markers', 'nightlife_markers_click',
		'restaurant_markers', 'restaurant_markers_click'
	];

	const lineLayerIds = [
		'line_red_markers', 'line_red_markers_click',
		'line_yellow_markers', 'line_yellow_markers_click',
		'line_grey_markers', 'line_grey_markers_click'
	];

	[...markerLayerIds, ...lineLayerIds].forEach(layerId => {
		map.off('click', layerId);
		map.off('mouseenter', layerId);
		map.off('mouseleave', layerId);
	});

	function handleFeatureClick(feature, e, isLine) {
		e.originalEvent.stopPropagation();

		if (currentPopup) {
			currentPopup.remove();
		}

		const coordinates = feature.geometry.type === 'Point' ?
			feature.geometry.coordinates.slice() :
			e.lngLat;

		if (feature.geometry.type === 'Point') {
			while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
				coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
			}
		}

		let isWithinBuffer = false;
		if (map.getSource('route-buffer')) {
			const bufferData = map.getSource('route-buffer')._data;
			if (bufferData && bufferData.geometry) {
				const point = turf.point(
					isLine ? [e.lngLat.lng, e.lngLat.lat] : feature.geometry.coordinates
				);
				isWithinBuffer = turf.booleanPointInPolygon(point, bufferData);
			}
		}

		selectedFeature = feature;

currentPopup = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: '300px'
    })
    .setLngLat(coordinates)
    .setHTML(getPopupContent(feature, coordinates, isLine))
    .addTo(map);

// LÄGG TILL DENNA KOD HÄR:
const popupEl = currentPopup.getElement();

// Navigate
const navBtn = popupEl.querySelector('.popup-action-btn.navigate');
if (navBtn) {
    navBtn.addEventListener('click', function() {
        const coords = navBtn.getAttribute('data-coords').split(',').map(Number);
        navigateToLocation(coords);
    });
}

// Save
const saveBtn = popupEl.querySelector('.popup-action-btn.save');
if (saveBtn) {
    saveBtn.addEventListener('click', function() {
        const name = decodeURIComponent(saveBtn.getAttribute('data-name'));
        updateSaveState(name);
    });
}

// Images
const imagesBtn = popupEl.querySelector('.popup-action-btn.images');
if (imagesBtn) {
    imagesBtn.addEventListener('click', function() {
        const name = decodeURIComponent(imagesBtn.getAttribute('data-name'));
        searchGoogleImages(name);
    });
}

// Search
const searchBtn = popupEl.querySelector('.popup-action-btn.search');
if (searchBtn) {
    searchBtn.addEventListener('click', function() {
        const name = decodeURIComponent(searchBtn.getAttribute('data-name'));
        searchGoogle(name);
    });
}

		const bottomMenu = document.getElementById('bottom-menu');
		if (bottomMenu && bottomMenu.style.display === 'flex') {
			const listingEl = document.getElementById('feature-listing');
			if (listingEl) {
				const previousActive = listingEl.querySelector('.active-listing');
				if (previousActive) {
					previousActive.classList.remove('active-listing');
				}

				const items = listingEl.getElementsByClassName('listing-item-container');
				Array.from(items).forEach(item => {
					const itemLink = item.querySelector('.listing-item');
					if (itemLink && itemLink.textContent === feature.properties.Name) {
						item.classList.add('active-listing');
						item.scrollIntoView({
							behavior: 'smooth',
							block: 'nearest'
						});
					}
				});
			}

			if (isWithinBuffer) {
				const routeListingEl = document.getElementById('route-attractions-listing');
				if (routeListingEl) {
					const previousActive = routeListingEl.querySelector('.active-listing');
					if (previousActive) {
						previousActive.classList.remove('active-listing');
					}

					const items = routeListingEl.getElementsByClassName('listing-item-container');
					Array.from(items).forEach(item => {
						const itemLink = item.querySelector('.listing-item');
						if (itemLink && itemLink.textContent === feature.properties.Name) {
							item.classList.add('active-listing');
							item.scrollIntoView({
								behavior: 'smooth',
								block: 'nearest'
							});
						}
					});
				}
			}
		}

		currentPopup.on('close', () => {
			const bottomMenu = document.getElementById('bottom-menu');
			if (bottomMenu && bottomMenu.style.display === 'flex') {
				const listingEl = document.getElementById('feature-listing');
				const routeListingEl = document.getElementById('route-attractions-listing');

				[listingEl, routeListingEl].forEach(container => {
					if (container) {
						const activeItem = container.querySelector('.active-listing');
						if (activeItem) {
							activeItem.classList.remove('active-listing');
						}
					}
				});
			}
			currentPopup = null;
			selectedFeature = null;
		});
	}

	map.on('click', (e) => {
		const markerFeatures = map.queryRenderedFeatures(e.point, {
			layers: markerLayerIds
		});

		if (markerFeatures.length > 0) {
			handleFeatureClick(markerFeatures[0], e, false);
			return;
		}

		const lineFeatures = map.queryRenderedFeatures(e.point, {
			layers: lineLayerIds
		});

		if (lineFeatures.length > 0) {
			handleFeatureClick(lineFeatures[0], e, true);
		}
	});

	[...markerLayerIds, ...lineLayerIds].forEach(layerId => {
		map.on('mouseenter', layerId, () => {
			map.getCanvas().style.cursor = 'pointer';
		});

		map.on('mouseleave', layerId, () => {
			map.getCanvas().style.cursor = '';
		});
	});
}

addClickablePointsAndLines();

function navigateToLocation(coords) {
	const url = `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`;
	window.open(url, '_blank');
}

function searchGoogle(name) {
	const url = `https://www.google.com/search?q=${encodeURIComponent(name)}`;
	window.open(url, '_blank');
}

function searchGoogleImages(name) {
	const url = `https://www.google.com/search?q=${encodeURIComponent(name)}&tbm=isch`;
	window.open(url, '_blank');
}

function saveAttraction(name) {
	const geojsonFeature = attractionsData.features.find(feature =>
		feature.properties.Name === name
	);

	let coordinates;
	let description = "";
	if (geojsonFeature) {
		coordinates = geojsonFeature.geometry.coordinates.join(', ');
		description = geojsonFeature.properties.Description || "";
	} else {
		const features = map.queryRenderedFeatures({
			layers: [
				'green_markers', 'yellow_markers', 'red_markers',
				'darkred_markers', 'grey_markers', 'white_markers',
				'accommodation_markers', 'nightlife_markers', 'restaurant_markers'
			]
		});

		const matchingFeature = features.find(feature =>
			feature.properties.Name === name
		);

		if (matchingFeature) {
			coordinates = matchingFeature.geometry.coordinates.join(', ');
			description = matchingFeature.properties.Description || "";
		} else {
			return;
		}
	}

	const cartData = JSON.parse(localStorage.getItem("titelSave") || "[]");
	const attractionExists = cartData.indexOf(name) !== -1;

	if (!attractionExists) {
		cartData.push(name, description, coordinates);
		localStorage.setItem("titelSave", JSON.stringify(cartData));
		createNotification(`Added to "Saved Attractions".`);
	} else {
		const index = cartData.indexOf(name);
		cartData.splice(index, 3);
		localStorage.setItem("titelSave", JSON.stringify(cartData));
		createNotification(`Removed from "Saved Attractions".`);
	}

	const listingEl = document.getElementById('feature-listing');
	if (listingEl) {
		const saveButtons = listingEl.querySelectorAll('.save-icon');
		saveButtons.forEach(button => {
			const listingItem = button.closest('.listing-item-container');
			const itemName = listingItem.querySelector('.listing-item').textContent;
			if (itemName === name) {
				const isSaved = !attractionExists;
				button.innerHTML = isSaved ?
					`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="#FF5722"/></svg>` :
					`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z"/></svg>`;
			}
		});
	}

	if (currentPopup) {
		const popupContent = currentPopup.getElement();
		const saveBtn = popupContent.querySelector('.popup-action-btn.save');
		if (saveBtn) {
			saveBtn.innerHTML = !attractionExists ?
				`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="#FF5722"/></svg> Save` :
				`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" fill="#FF5722"/></svg> Save`;
		}
	}

	const allPopups = document.querySelectorAll('.mapboxgl-popup');
	allPopups.forEach(popup => {
		const popupNameEl = popup.querySelector('.popup-title');
		if (popupNameEl && popupNameEl.textContent === name) {
			const saveBtn = popup.querySelector('.popup-action-btn.save');
			if (saveBtn) {
				saveBtn.innerHTML = !attractionExists ?
					`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="#FF5722"/></svg> Save` :
					`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" fill="#FF5722"/></svg> Save`;
			}
		}
	});

	displayCart();
}

function createNotification(message) {
	const notification = document.createElement('div');
	notification.className = 'notification';
	notification.textContent = message;

	const existingNotification = document.querySelector('.notification');
	if (existingNotification) {
		existingNotification.remove();
	}

	document.body.appendChild(notification);

	notification.addEventListener('animationend', function(e) {
		if (e.animationName === 'fadeOut') {
			notification.remove();
		}
	});
}

function adjustMapViewport() {
	const mapContainer = document.getElementById('map');
	const sidenav = document.querySelector('.sidenav');

	if (sidenav && sidenav.classList.contains('open')) {
		mapContainer.style.width = 'calc(100% - 350px)';
	} else {
		mapContainer.style.width = '100%';
	}

	map.resize();
}

function renderRouteAttractions(features) {
	const routeListingEl = document.getElementById('route-attractions-listing');

	// Add click handler if not already added
	if (!document.querySelector('.popup-click-handler')) {
		const clickHandler = (e) => {
			if (currentPopup) {
				const isClickOutside = !e.target.closest('.mapboxgl-popup') &&
					!e.target.closest('.listing-item-container') &&
					!e.target.closest('.popup-action-btn');

				if (isClickOutside) {
					currentPopup.remove();
					const activeItem = routeListingEl.querySelector('.active-listing');
					if (activeItem) {
						activeItem.classList.remove('active-listing');
					}
					selectedFeature = null;
					currentPopup = null;
				}
			}
		};
		document.addEventListener('click', clickHandler);
		document.body.classList.add('popup-click-handler');
	}

	routeListingEl.innerHTML = '';

	if (!features.length) {
		routeListingEl.innerHTML = '<p style="color: #FFFFFF; text-align: center; margin-top: 10px;">No attractions found within the route radius.</p>';
		return;
	}

	features.forEach(feature => {
		const itemContainer = document.createElement('div');
		itemContainer.className = 'listing-item-container';

		const iconContainer = document.createElement('div');
		iconContainer.className = 'listing-icons';

		const setActiveItem = (container, feature, coordinates) => {
			if (selectedFeature && selectedFeature.properties.Name === feature.properties.Name) {
				container.classList.remove('active-listing');
				if (currentPopup) {
					currentPopup.remove();
				}
				selectedFeature = null;
				currentPopup = null;
				return;
			}

			document.querySelectorAll('.listing-item-container').forEach(item => {
				item.classList.remove('active-listing');
			});

			if (currentPopup) {
				currentPopup.remove();
			}

			container.classList.add('active-listing');
			selectedFeature = feature;

			currentPopup = new mapboxgl.Popup({
					closeButton: true,
					closeOnClick: false,
					className: 'feature-popup'
				})
				.setLngLat(coordinates)
				.setHTML(getPopupContent(feature, coordinates))
				.addTo(map);

			currentPopup.on('close', () => {
				if (container.classList.contains('active-listing')) {
					container.classList.remove('active-listing');
				}
				selectedFeature = null;
				currentPopup = null;
			});
		};

		const navigateIcon = document.createElement('button');
		navigateIcon.className = 'listing-icon-btn navigate-icon';
		navigateIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
		navigateIcon.title = 'Navigate';
		navigateIcon.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			setActiveItem(itemContainer, feature, feature.geometry.coordinates);
			navigateToLocation(feature.geometry.coordinates);
		};

		const imagesIcon = document.createElement('button');
		imagesIcon.className = 'listing-icon-btn images-icon';
		imagesIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
		imagesIcon.title = 'View Images';
		imagesIcon.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			setActiveItem(itemContainer, feature, feature.geometry.coordinates);
			searchGoogleImages(escapeHtml(feature.properties.Name));
		};

		const searchIcon = document.createElement('button');
		searchIcon.className = 'listing-icon-btn search-icon';
		searchIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
		searchIcon.title = 'Search Info';
		searchIcon.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			setActiveItem(itemContainer, feature, feature.geometry.coordinates);
			searchGoogle(escapeHtml(feature.properties.Name));
		};

		const saveIcon = document.createElement('button');
		saveIcon.className = 'listing-icon-btn save-icon';
		const name = escapeHtml(feature.properties.Name);
		const isSaved = isAttractionSaved(name);
		saveIcon.innerHTML = isSaved ?
			`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="#FF5722"/></svg>` :
			`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" fill="#FF5722"/></svg>`;
		saveIcon.title = 'Save';

		saveIcon.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			setActiveItem(itemContainer, feature, feature.geometry.coordinates);
			updateSaveState(name);
			displayCart();
		};

		iconContainer.appendChild(navigateIcon);
		iconContainer.appendChild(imagesIcon);
		iconContainer.appendChild(searchIcon);
		iconContainer.appendChild(saveIcon);

		const itemLink = document.createElement('a');
		itemLink.className = 'listing-item';
		itemLink.href = '#';
		itemLink.textContent = name;

		if (selectedFeature && selectedFeature.properties.Name === name) {
			itemContainer.classList.add('active-listing');
		}

		const handleSelection = (e) => {
			const isIconClick = e.target.closest('.listing-icon-btn') || e.target.closest('.listing-icons');
			if (isIconClick) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();
			setActiveItem(itemContainer, feature, feature.geometry.coordinates);
		};

		itemContainer.addEventListener('click', (e) => {
			if (isTouchEvent) {
				isTouchEvent = false;
				return;
			}
			handleSelection(e);
		});

		itemContainer.addEventListener('touchstart', (e) => {
			const isIconTouch = e.target.closest('.listing-icon-btn') || e.target.closest('.listing-icons');
			if (isIconTouch) {
				return;
			}
			touchStartY = e.touches[0].clientY;
			isTouchScrolling = false;
		});

		itemContainer.addEventListener('touchmove', (e) => {
			if (!touchStartY) return;

			const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
			if (deltaY > 5) {
				isTouchScrolling = true;
				itemContainer.classList.remove('touch-active');
			}
		});

		itemContainer.addEventListener('touchend', (e) => {
			if (!touchStartY) return;

			const isIconTouch = e.target.closest('.listing-icon-btn') || e.target.closest('.listing-icons');
			if (isIconTouch || isTouchScrolling) {
				touchStartY = null;
				isTouchScrolling = false;
				return;
			}

			itemContainer.classList.remove('touch-active');
			handleSelection(e);
			touchStartY = null;
		});

		if (window.matchMedia('(hover: hover)').matches) {
			itemContainer.addEventListener('mouseover', () => {
				if ((!selectedFeature || selectedFeature.properties.Name !== name) && !currentPopup) {
					currentPopup = new mapboxgl.Popup({
							closeButton: false,
							closeOnClick: false
						})
						.setLngLat(feature.geometry.coordinates)
						.setHTML(getPopupContent(feature, feature.geometry.coordinates))
						.addTo(map);
				}
			});

			itemContainer.addEventListener('mouseout', () => {
				if (currentPopup && currentPopup.getElement && currentPopup.getElement()) {
					if (!currentPopup.getElement().querySelector('.mapboxgl-popup-close-button')) {
						currentPopup.remove();
						currentPopup = null;
					}
				}
			});
		}

		itemContainer.appendChild(iconContainer);
		itemContainer.appendChild(itemLink);
		routeListingEl.appendChild(itemContainer);

		if (selectedFeature && selectedFeature.properties.Name === feature.properties.Name) {
			itemContainer.scrollIntoView({
				behavior: 'smooth',
				block: 'nearest'
			});
		}
	});
}

function updateRouteAttractions(coordinates) {
	console.log('Updating route attractions...');
	console.log('Coordinates:', coordinates);
	console.log('Has attractionsData:', !!attractionsData);

	if (!coordinates || !attractionsData) {
		console.log('Missing required data');
		return;
	}

	try {
		const routeLine = turf.lineString(coordinates);
		const radiusKm = parseInt(document.getElementById('route-radius')?.value || 50);
		const buffered = turf.buffer(routeLine, radiusKm, {
			units: 'kilometers'
		});

		const selectedName = selectedFeature ? selectedFeature.properties.Name : null;

		const nearbyAttractions = attractionsData.features.filter(feature => {
			if (!feature.geometry || feature.geometry.type !== 'Point') return false;
			const point = turf.point(feature.geometry.coordinates);
			const isInBuffer = turf.booleanPointInPolygon(point, buffered);

			if (selectedName && feature.properties.Name === selectedName && isInBuffer) {
				selectedFeature = feature;
			}

			return isInBuffer;
		});

		console.log('Found nearby attractions:', nearbyAttractions.length);

		renderRouteAttractions(nearbyAttractions);

	} catch (error) {
		console.error('Error updating route attractions:', error);
	}
}

function displayCart() {
	const cartElement = document.getElementById('cart');
	if (!cartElement) return;

	const cartData = JSON.parse(localStorage.getItem("titelSave") || "[]");

	let containerDiv = document.createElement('div');
	containerDiv.style.backgroundColor = '#22272e';
	containerDiv.style.border = '1px solid #444c56';
	containerDiv.style.borderRadius = '4px';
	containerDiv.style.overflow = 'auto';
	containerDiv.style.padding = '2%';
	containerDiv.style.boxSizing = 'border-box';

	if (cartData.length === 0) {
		const emptyMessage = document.createElement('div');
		emptyMessage.textContent = ' - List is empty - ';
		emptyMessage.style.color = '#ffffff';
		emptyMessage.style.textAlign = 'center';
		emptyMessage.style.padding = '10px';
		containerDiv.appendChild(emptyMessage);
	} else {
		for (let i = 0; i < cartData.length; i += 3) {
			const itemDiv = document.createElement('div');
			itemDiv.style.display = 'flex';
			itemDiv.style.alignItems = 'center';
			itemDiv.style.marginBottom = '2%';
			itemDiv.style.color = '#ffffff';
			itemDiv.style.fontSize = '0.9em';

			const deleteBtn = document.createElement('button');
			deleteBtn.innerHTML = '×';
			deleteBtn.style.color = '#ff4444';
			deleteBtn.style.backgroundColor = 'transparent';
			deleteBtn.style.border = 'none';
			deleteBtn.style.fontSize = '1.2em';
			deleteBtn.style.cursor = 'pointer';
			deleteBtn.style.padding = '0 2%';
			deleteBtn.style.marginRight = '2%';
			deleteBtn.style.lineHeight = '1';
			deleteBtn.title = 'Remove attraction';

			deleteBtn.addEventListener('mouseenter', () => {
				deleteBtn.style.transform = 'scale(1.2)';
			});
			deleteBtn.addEventListener('mouseleave', () => {
				deleteBtn.style.transform = 'scale(1)';
			});

			deleteBtn.onclick = ((index) => {
				return () => {
					cartData.splice(index, 3);
					localStorage.setItem("titelSave", JSON.stringify(cartData));
					displayCart();
				};
			})(i);

			const textSpan = document.createElement('span');
			textSpan.textContent = cartData[i];
			textSpan.style.overflow = 'hidden';
			textSpan.style.textOverflow = 'ellipsis';
			textSpan.style.whiteSpace = 'nowrap';
			textSpan.style.flex = '1';

			itemDiv.appendChild(deleteBtn);
			itemDiv.appendChild(textSpan);
			containerDiv.appendChild(itemDiv);
		}
	}

	cartElement.innerHTML = '';
	cartElement.appendChild(containerDiv);
}

function ClearShop() {
	if (confirm('Are you sure you want to clear all?')) {
		localStorage.removeItem("titelSave");
		displayCart();
	}
}


function JSONToCSVConvertor() {
	const cartData = JSON.parse(localStorage.getItem("titelSave") || "[]");
	if (cartData.length === 0) {
		alert('You need to add at least one attraction!');
		return;
	}

	if (!attractionsData || !attractionsData.features) {
		alert('Error: Could not access coordinate data');
		return;
	}

	const featureLookup = new Map(
		attractionsData.features.map(feature => [
			feature.properties.Name,
			feature.geometry.coordinates
		])
	);

	let CSV = '\ufeff';

	CSV += '- Presented by Resekartan -\r\n\r\n';
	CSV += 'Attraction,Comment,Coordinates\r\n';

	for (let i = 0; i < cartData.length; i += 3) {
		const attraction = cartData[i];
		const comment = cartData[i + 1] || '';
		const savedCoords = cartData[i + 2];

		let coordinates;
		const geojsonCoords = featureLookup.get(attraction);

		if (geojsonCoords) {
			const [lng, lat] = geojsonCoords;
			coordinates = `${lat}, ${lng}`;
		} else {
			coordinates = savedCoords;
		}

		const escapeField = (field) => {
			if (field.includes(',') || field.includes('"') || field.includes('\n')) {
				return `"${field.replace(/"/g, '""')}"`;
			}
			return field;
		};

		CSV += `${escapeField(attraction)},${escapeField(comment)},${escapeField(coordinates)}\r\n`;
	}

	const blob = new Blob([CSV], {
		type: 'text/csv;charset=utf-8;'
	});

	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `exported-markers-resekartan-${new Date().toISOString().split('T')[0]}.csv`;

	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}


function downloadFile(content, fileName, mimeType) {
	const blob = new Blob([content], {
		type: mimeType
	});
	const url = window.URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	window.URL.revokeObjectURL(url);
}

function JSONToKMLConvertor() {
	const cartData = JSON.parse(localStorage.getItem("titelSave") || "[]");
	if (cartData.length === 0) {
		alert('You need to add at least one attraction!');
		return;
	}

	if (!attractionsData || !attractionsData.features) {
		alert('Error: Could not access coordinate data');
		return;
	}

	const featureLookup = new Map(
		attractionsData.features.map(feature => [
			feature.properties.Name,
			feature.geometry.coordinates
		])
	);

	let kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
	kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
	kml += '<Document>\n';
	kml += '<name>attractions_kml_resekartan</name>\n';
	kml += '<description>Exported attractions by Resekartan</description>\n';

	kml += `
        <Style id="icon-1899-FF5252-nodesc">
            <IconStyle>
                <color>ff5252FF</color>
                <scale>1.1</scale>
                <Icon>
                    <href>img/503-wht-blank_maps.png</href>
                </Icon>
            </IconStyle>
            <LabelStyle>
                <scale>0</scale>
            </LabelStyle>
        </Style>
    `;

	for (let i = 0; i < cartData.length; i += 3) {
		const attraction = cartData[i];
		const description = cartData[i + 1] || '';
		const savedCoords = cartData[i + 2].split(', ');

		let coordinates;
		const geojsonCoords = featureLookup.get(attraction);

		if (geojsonCoords) {
			coordinates = geojsonCoords;
		} else {
			coordinates = [parseFloat(savedCoords[0]), parseFloat(savedCoords[1])];
		}

		kml += `<Placemark>\n`;
		kml += `<name><![CDATA[${attraction}]]></name>\n`;
		kml += `<description><![CDATA[${description}]]></description>\n`;
		kml += `<styleUrl>#icon-1899-FF5252-nodesc</styleUrl>\n`;
		kml += `<Point>\n<coordinates>${coordinates.join(',')}</coordinates>\n</Point>\n`;
		kml += `</Placemark>\n`;
	}

	kml += '</Document>\n</kml>';

	const currentDate = new Date().toISOString().split('T')[0];
	downloadFile(
		kml,
		`exported-markers-kml-resekartan-${currentDate}.kml`,
		'application/vnd.google-earth.kml+xml;charset=UTF-8'
	);
}

function toggleMeasurement() {
	if (measurementLocked) {
		measurementActive = false;
		isDrawingLine = false;
		measurementLocked = false;
		measureButton.classList.remove('measure-active');
		updateMapCursor(false);
		points = [];
		updateLine();
		updatePoints();
		document.getElementById('distance-container').style.display = 'none';
	} else if (!measurementActive) {
		measurementActive = true;
		isDrawingLine = true;
		measurementLocked = false;
		measureButton.classList.add('measure-active');
		updateMapCursor(true);
	} else {
		measurementActive = false;
		isDrawingLine = false;
		measurementLocked = false;
		measureButton.classList.remove('measure-active');
		updateMapCursor(false);
		points = [];
		updateLine();
		updatePoints();
		document.getElementById('distance-container').style.display = 'none';
	}
}

function initializeListingFunctionality() {
	const filterEl = document.getElementById('feature-filter');
	const listingEl = document.getElementById('feature-listing');
	const MIN_ZOOM_LEVEL = 7;
	let features = [];
	let activeListItem = null;


	function markListItem(feature) {
		if (activeListItem) {
			activeListItem.classList.remove('active-listing');
		}

		const items = listingEl.getElementsByTagName('a');
		for (const item of items) {
			if (item.textContent === feature.properties.Name) {
				item.classList.add('active-listing');
				activeListItem = item;
				selectedFeature = feature;

				item.scrollIntoView({
					behavior: 'smooth',
					block: 'nearest'
				});
				break;
			}
		}
	}

	function renderListings(features) {
		if (!document.querySelector('.popup-click-handler')) {
			const clickHandler = (e) => {
				if (currentPopup) {
					const isClickOutside = !e.target.closest('.mapboxgl-popup') &&
						!e.target.closest('.listing-item-container') &&
						!e.target.closest('.popup-action-btn');

					if (isClickOutside) {
						currentPopup.remove();
						if (activeListItem) {
							activeListItem.classList.remove('active-listing');
						}
						activeListItem = null;
						selectedFeature = null;
						currentPopup = null;
					}
				}
			};
			document.addEventListener('click', clickHandler);
			document.body.classList.add('popup-click-handler');
		}

		const empty = document.createElement('h2');
		empty.style.cssText = 'color: #FFFFFF; text-align: center; margin-top: 10px;';
		listingEl.innerHTML = '';

		if (map.getZoom() < MIN_ZOOM_LEVEL) {
			empty.textContent = 'Zoom in the map to populate results!';
			filterEl.parentNode.style.display = 'none';
			filterEl.value = '';
			listingEl.appendChild(empty);
			return;
		}

		filterEl.parentNode.style.display = 'block';

		if (features.length) {
			for (const feature of features) {
				const itemContainer = document.createElement('div');
				itemContainer.className = 'listing-item-container';

				const iconContainer = document.createElement('div');
				iconContainer.className = 'listing-icons';

				const setActiveItem = (container, feature, coordinates) => {
					if (selectedFeature && selectedFeature.properties.Name === feature.properties.Name) {
						container.classList.remove('active-listing');
						if (currentPopup) {
							currentPopup.remove();
						}
						activeListItem = null;
						selectedFeature = null;
						currentPopup = null;
						return;
					}

					document.querySelectorAll('.listing-item-container').forEach(item => {
						item.classList.remove('active-listing');
					});

					if (currentPopup) {
						currentPopup.remove();
					}

					container.classList.add('active-listing');
					activeListItem = container;
					selectedFeature = feature;

					currentPopup = new mapboxgl.Popup({
							closeButton: true,
							closeOnClick: false,
							className: 'feature-popup'
						})
						.setLngLat(coordinates)
						.setHTML(getPopupContent(feature, coordinates))
						.addTo(map);
						// LÄGG TILL DETTA DIREKT EFTER:
						const popupEl = currentPopup.getElement();
if (popupEl) {
    // Navigate
    const navBtn = popupEl.querySelector('.popup-action-btn.navigate');
    if (navBtn) {
        navBtn.addEventListener('click', function() {
            const coords = navBtn.getAttribute('data-coords').split(',').map(Number);
            navigateToLocation(coords);
        });
    }

    // Save
    const saveBtn = popupEl.querySelector('.popup-action-btn.save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            const name = decodeURIComponent(saveBtn.getAttribute('data-name'));
            updateSaveState(name);
        });
    }

    // Images
    const imagesBtn = popupEl.querySelector('.popup-action-btn.images');
    if (imagesBtn) {
        imagesBtn.addEventListener('click', function() {
            const name = decodeURIComponent(imagesBtn.getAttribute('data-name'));
            searchGoogleImages(name);
        });
    }

    // Search
    const searchBtn = popupEl.querySelector('.popup-action-btn.search');
    if (searchBtn) {
        searchBtn.addEventListener('click', function() {
            const name = decodeURIComponent(searchBtn.getAttribute('data-name'));
            searchGoogle(name);
        });
    }
}

					currentPopup.on('close', () => {
						if (activeListItem) {
							activeListItem.classList.remove('active-listing');
						}
						activeListItem = null;
						selectedFeature = null;
						currentPopup = null;
					});
				};

				const navigateIcon = document.createElement('button');
				navigateIcon.className = 'listing-icon-btn navigate-icon';
				navigateIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
				navigateIcon.title = 'Navigate';
				navigateIcon.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					setActiveItem(itemContainer, feature, feature.geometry.coordinates);
					navigateToLocation(feature.geometry.coordinates);
				};

				const imagesIcon = document.createElement('button');
				imagesIcon.className = 'listing-icon-btn images-icon';
				imagesIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
				imagesIcon.title = 'View Images';
				imagesIcon.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					setActiveItem(itemContainer, feature, feature.geometry.coordinates);
					searchGoogleImages(escapeHtml(feature.properties.Name));
				};

				const searchIcon = document.createElement('button');
				searchIcon.className = 'listing-icon-btn search-icon';
				searchIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
				searchIcon.title = 'Search Info';
				searchIcon.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					setActiveItem(itemContainer, feature, feature.geometry.coordinates);
					searchGoogle(escapeHtml(feature.properties.Name));
				};

				const saveIcon = document.createElement('button');
				saveIcon.className = 'listing-icon-btn save-icon';
				const name = escapeHtml(feature.properties.Name);
				const isSaved = isAttractionSaved(name);
				saveIcon.innerHTML = isSaved ?
					`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="#FF5722"/></svg>` :
					`<svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" fill="#FF5722"/></svg>`;
				saveIcon.title = 'Save';

				saveIcon.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					setActiveItem(itemContainer, feature, feature.geometry.coordinates);
					updateSaveState(name);
					displayCart();
				};

				iconContainer.appendChild(navigateIcon);
				iconContainer.appendChild(imagesIcon);
				iconContainer.appendChild(searchIcon);
				iconContainer.appendChild(saveIcon);

				const itemLink = document.createElement('a');
				itemLink.className = 'listing-item';
				itemLink.href = '#';
				itemLink.textContent = name;

				if (selectedFeature && selectedFeature.properties.Name === name) {
					itemContainer.classList.add('active-listing');
					activeListItem = itemContainer;
				}

				const handleSelection = (e) => {
					const isIconClick = e.target.closest('.listing-icon-btn') || e.target.closest('.listing-icons');
					if (isIconClick) {
						return;
					}

					e.preventDefault();
					e.stopPropagation();
					setActiveItem(itemContainer, feature, feature.geometry.coordinates);
				};

				itemContainer.addEventListener('click', (e) => {
					if (isTouchEvent) {
						isTouchEvent = false;
						return;
					}
					handleSelection(e);
				});

				itemContainer.addEventListener('touchstart', (e) => {
					const isIconTouch = e.target.closest('.listing-icon-btn') || e.target.closest('.listing-icons');
					if (isIconTouch) {
						return;
					}
					touchStartY = e.touches[0].clientY;
					isTouchScrolling = false;
				});

				itemContainer.addEventListener('touchmove', (e) => {
					if (!touchStartY) return;

					const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
					if (deltaY > 5) {
						isTouchScrolling = true;
						itemContainer.classList.remove('touch-active');
					}
				});

				itemContainer.addEventListener('touchend', (e) => {
					if (!touchStartY) return;

					const isIconTouch = e.target.closest('.listing-icon-btn') || e.target.closest('.listing-icons');
					if (isIconTouch || isTouchScrolling) {
						touchStartY = null;
						isTouchScrolling = false;
						return;
					}

					itemContainer.classList.remove('touch-active');
					handleSelection(e);
					touchStartY = null;
				});

				if (window.matchMedia('(hover: hover)').matches) {
					itemContainer.addEventListener('mouseover', () => {
						if ((!selectedFeature || selectedFeature.properties.Name !== name) && !currentPopup) {
							currentPopup = new mapboxgl.Popup({
									closeButton: false,
									closeOnClick: false
								})
								.setLngLat(feature.geometry.coordinates)
								.setHTML(getPopupContent(feature, feature.geometry.coordinates))
								.addTo(map);
						}
					});

					itemContainer.addEventListener('mouseout', () => {
						if (currentPopup && currentPopup.getElement && currentPopup.getElement()) {
							if (!currentPopup.getElement().querySelector('.mapboxgl-popup-close-button')) {
								currentPopup.remove();
								currentPopup = null;
							}
						}
					});
				}

				itemContainer.appendChild(iconContainer);
				itemContainer.appendChild(itemLink);
				listingEl.appendChild(itemContainer);
			}
		} else {
			empty.textContent = filterEl.value !== '' ? 'No results found!' : 'No results found!';
			listingEl.appendChild(empty);
		}
	}

	map.on('zoom', () => {
		if (map.getZoom() < MIN_ZOOM_LEVEL) {
			filterEl.parentNode.style.display = 'none';
			filterEl.value = '';
		}
	});

	function updateListing() {
		if (map.getZoom() < MIN_ZOOM_LEVEL) {
			listingEl.innerHTML = '<h4 style="color: #FFFFFF; text-align: center; margin-top: 10px;">Zoom in the map to populate results!</h4>';
			return;
		}



		const renderedFeatures = map.queryRenderedFeatures({
			layers: [
				'green_markers', 'yellow_markers', 'red_markers',
				'darkred_markers', 'grey_markers', 'white_markers',
				'accommodation_markers', 'nightlife_markers', 'restaurant_markers'
			]
		});
		features = getUniqueFeatures(renderedFeatures, 'Name');
		renderListings(features);
	}

	filterEl.addEventListener('keyup', (e) => {
		const value = e.target.value.toLowerCase();
		const filtered = features.filter(feature => {
			const name = (feature.properties.Name || '').toLowerCase();
			const description = (feature.properties.Description || '').toLowerCase();
			return name.includes(value) || description.includes(value);
		});
		renderListings(filtered);
	});

	map.on('moveend', updateListing);
	map.on('zoomend', updateListing);
	updateListing();
}

function getUniqueFeatures(features, property) {
	const uniqueFeatures = [];
	const seen = new Set();

	for (const feature of features) {
		const prop = feature.properties[property];
		if (!seen.has(prop)) {
			seen.add(prop);
			uniqueFeatures.push(feature);
		}
	}
	return uniqueFeatures;
}

function updateMapCursor(active) {
	const mapContainer = map.getContainer();
	if (active) {
		mapContainer.classList.add('measuring');
	} else {
		mapContainer.classList.remove('measuring');
	}
}

map.on('click', (e) => {
	if (!measurementActive || !isDrawingLine || measurementLocked) return;

	points.push([e.lngLat.lng, e.lngLat.lat]);
	updateLine();
	updatePoints();

	if (points.length > 0) {
		const distanceContainer = document.getElementById('distance-container');
		distanceContainer.style.display = 'flex';

		if (points.length >= 2) {
			const lengthKm = turf.length(turf.lineString(points), {
				units: 'kilometers'
			});
			const lengthMi = lengthKm * 0.621371;
			document.getElementById('calculated-distance').textContent = ' ' + Math.round(lengthKm * 100) / 100;
			document.getElementById('calculated-distance-miles').textContent = ' ' + Math.round(lengthMi * 100) / 100;
		}
	}
});

map.on('mousemove', (e) => {
	if (!measurementActive || points.length === 0) return;

	const currentPoints = [...points, [e.lngLat.lng, e.lngLat.lat]];
	updateLine(currentPoints);

	if (points.length >= 1) {
		const lengthKm = turf.length(turf.lineString(currentPoints), {
			units: 'kilometers'
		});
		const lengthMi = lengthKm * 0.621371;
		document.getElementById('calculated-distance').textContent = Math.round(lengthKm * 100) / 100;
		document.getElementById('calculated-distance-miles').textContent = Math.round(lengthMi * 100) / 100;
	}
});

map.on('dblclick', (e) => {
	if (!measurementActive || !isDrawingLine) return;

	e.preventDefault();

	if (points.length > 0) {
		points.push([e.lngLat.lng, e.lngLat.lat]);
		updateLine();
		updatePoints();
		const lengthKm = turf.length(turf.lineString(points), {
			units: 'kilometers'
		});
		const lengthMi = lengthKm * 0.621371;
		document.getElementById('calculated-distance').textContent = Math.round(lengthKm * 100) / 100;
		document.getElementById('calculated-distance-miles').textContent = Math.round(lengthMi * 100) / 100;
	}

	isDrawingLine = false;
	measurementLocked = true;
	measurementActive = false;
	updateMapCursor(false);
});



function updateLine(coords = points) {
	map.getSource('measure-line').setData({
		type: 'Feature',
		properties: {},
		geometry: {
			type: 'LineString',
			coordinates: coords
		}
	});
}

function updatePoints() {
	const features = points.map(point => ({
		type: 'Feature',
		properties: {},
		geometry: {
			type: 'Point',
			coordinates: point
		}
	}));
	map.getSource('measure-points').setData({
		type: 'FeatureCollection',
		features: features
	});
}

map.on('touchstart', (e) => {
	touchStartPos = e.point;
});

map.on('touchend', (e) => {
	if (touchStartPos &&
		Math.abs(touchStartPos.x - e.point.x) < 10 &&
		Math.abs(touchStartPos.y - e.point.y) < 10) {

		const currentTime = new Date().getTime();
		const tapLength = currentTime - lastTap;

		clearTimeout(touchTimeout);

		if (tapLength < 300 && tapLength > 0) {
			if (!measurementActive || !isDrawingLine) return;

			e.preventDefault();

			if (points.length > 0) {
				points.push([e.lngLat.lng, e.lngLat.lat]);
				updateLine();
				updatePoints();
				const lengthKm = turf.length(turf.lineString(points), {
					units: 'kilometers'
				});
				const lengthMi = lengthKm * 0.621371;
				document.getElementById('calculated-distance').textContent = Math.round(lengthKm * 100) / 100;
				document.getElementById('calculated-distance-miles').textContent = Math.round(lengthMi * 100) / 100;
			}

			isDrawingLine = false;
			measurementLocked = true;
			measurementActive = false;
			updateMapCursor(false);
		} else {
			if (!measurementActive || !isDrawingLine || measurementLocked) return;

			points.push([e.lngLat.lng, e.lngLat.lat]);
			updateLine();
			updatePoints();

			if (points.length > 0) {
				const distanceContainer = document.getElementById('distance-container');
				distanceContainer.style.display = 'flex';

				if (points.length >= 2) {
					const lengthKm = turf.length(turf.lineString(points), {
						units: 'kilometers'
					});
					const lengthMi = lengthKm * 0.621371;
					document.getElementById('calculated-distance').textContent = Math.round(lengthKm * 100) / 100;
					document.getElementById('calculated-distance-miles').textContent = Math.round(lengthMi * 100) / 100;
				}
			}
			lastTap = currentTime;
		}
	}
	touchStartPos = null;
});

map.on('touchstart', (e) => {
	if (measurementActive) {
		e.originalEvent.preventDefault();
	}
});

function toggleMenu() {
	const mySidenav = document.getElementById('mySidenav');
	const mapElement = document.getElementById('map');
	const bottomMenu = document.getElementById('bottom-menu');
	const buttonContainer = document.getElementById('button-container');
	const tabContent = document.getElementById('tab-content');
	const menuButton = document.querySelector('.menu-toggle');
	const menuToggleContainer = document.querySelector('.menu-toggle-container');
	const sidenavContent = document.querySelector('.sidenav-content');
	const body = document.body;


	function resetRouteData() {
		startCoords = null;
		endCoords = null;

		if (map.getSource('route')) {
			map.getSource('route').setData({
				'type': 'Feature',
				'geometry': {
					'type': 'LineString',
					'coordinates': []
				}
			});
		}
		if (map.getSource('route-buffer')) {
			map.getSource('route-buffer').setData({
				'type': 'Feature',
				'geometry': {
					'type': 'Polygon',
					'coordinates': []
				}
			});
		}

		const startInput = document.getElementById('start-point');
		const endInput = document.getElementById('end-point');
		if (startInput) startInput.value = '';
		if (endInput) endInput.value = '';

		const routeInfo = document.getElementById('route-info');
		if (routeInfo) routeInfo.innerHTML = '';

		const routeAttractions = document.getElementById('route-attractions-listing');
		if (routeAttractions) routeAttractions.innerHTML = '';
	}

	menuToggleContainer.classList.add('open');

	if (bottomMenu.style.display === 'flex') {
		bottomMenu.style.display = 'none';
		mapElement.style.height = '100%';
		mapElement.classList.remove('list-view');
		buttonContainer.style.display = 'flex';
		tabContent.style.display = 'none';
		searchContainer.classList.remove('search-visible');
		menuButton.classList.remove('close');
		sidenavContent.classList.remove('tab-active');
		resetRouteData();
	} else {

		const isOpen = mySidenav.classList.contains('open');

		if (isOpen) {
			mySidenav.classList.remove('open');
			body.classList.remove('sidenav-open');
			buttonContainer.style.display = 'flex';
			tabContent.style.display = 'none';
			searchContainer.classList.remove('search-visible');
			menuButton.classList.remove('close');
			menuToggleContainer.classList.remove('open');
			sidenavContent.classList.remove('tab-active');
			resetRouteData();
		} else {
			mySidenav.classList.add('open');
			body.classList.add('sidenav-open');
			searchContainer.classList.add('search-visible');
			menuButton.classList.add('close');
			buttonContainer.style.display = 'flex';
			sidenavContent.classList.remove('tab-active');
		}
	}

	setTimeout(() => {
		map.resize();
	}, 300);
}


window.addEventListener('resize', () => {
	const mySidenav = document.getElementById('mySidenav');
	const isOpen = mySidenav.classList.contains('open');

	if (isOpen) {
		document.body.classList.add('sidenav-open');
	}

	map.resize();
});

function handleLayerToggle(checkbox) {
	const layerId = checkbox.getAttribute('data-layer');
	const visibility = checkbox.checked ? 'visible' : 'none';
	console.log(`Setting visibility for ${layerId} to ${visibility}`);
	map.setLayoutProperty(layerId, 'visibility', visibility);
	layerVisibility[layerId] = visibility;

	if (layerId.startsWith('line_')) {
		const clickLayerId = `${layerId}_click`;
		map.setLayoutProperty(clickLayerId, 'visibility', visibility);
		layerVisibility[clickLayerId] = visibility;
	} else {
		const clickLayerId = `${layerId}_click`;
		if (map.getLayer(clickLayerId)) {
			map.setLayoutProperty(clickLayerId, 'visibility', visibility);
			layerVisibility[clickLayerId] = visibility;
		}
	}

	if (visibility === 'none' && currentPopup) {
		const popupFeature = selectedFeature;
		if (popupFeature && popupFeature.layer && popupFeature.layer.id === layerId) {
			currentPopup.remove();
			currentPopup = null;
			selectedFeature = null;
		}
	}
}

function initializeFilters() {
	const checkboxes = document.querySelectorAll('.compact-checkbox input[type="checkbox"]');

	checkboxes.forEach(checkbox => {
		const layerId = checkbox.dataset.layer;
		console.log(`Initializing filter for layer: ${layerId}`);

		layerVisibility[layerId] = checkbox.checked ? 'visible' : 'none';

		if (map.getLayer(layerId)) {
			checkbox.addEventListener('change', function() {
				handleLayerToggle(this);
			});
		} else {
			console.warn(`Layer ${layerId} not found`);
		}
	});
}

function initializeStyleSelector() {
	const styleCircles = document.querySelectorAll('.style-circle');
	console.log('Initializing style selector, found circles:', styleCircles.length);

	styleCircles.forEach(circle => {
		circle.addEventListener('click', function(e) {
			e.preventDefault();

			if (this.classList.contains('active')) {
				return;
			}

			const styleUrl = this.dataset.style;
			const newProjection = this.dataset.projection;

			const layers = ['green_markers', 'yellow_markers', 'red_markers',
				'darkred_markers', 'grey_markers', 'white_markers',
				'accommodation_markers', 'nightlife_markers', 'restaurant_markers',
				'line_yellow_markers', 'line_red_markers', 'line_grey_markers'
			];

			layers.forEach(layerId => {
				const visibility = map.getLayoutProperty(layerId, 'visibility') || 'visible';
				layerVisibility[layerId] = visibility;
			});

			activeMapStyle = styleUrl;

			styleCircles.forEach(c => c.classList.remove('active'));
			this.classList.add('active');

			map.setStyle(styleUrl, {
				diff: false,
				preserve: true
			});

			map.once('style.load', () => {
				Object.keys(layerVisibility).forEach(layerId => {
					map.setLayoutProperty(layerId, 'visibility', layerVisibility[layerId]);

					const checkbox = document.querySelector(`input[data-layer="${layerId}"]`);
					if (checkbox) {
						checkbox.checked = layerVisibility[layerId] === 'visible';
					}
				});
			});

			if (newProjection) {
				map.setProjection(newProjection);
			}

			const mySidenav = document.getElementById('mySidenav');
			const body = document.body;
			const menuButton = document.querySelector('.menu-toggle');
			const menuToggleContainer = document.querySelector('.menu-toggle-container');
			const buttonContainer = document.getElementById('button-container');
			const tabContent = document.getElementById('tab-content');
			const searchContainer = document.getElementById('search-container');

			mySidenav.classList.remove('open');
			body.classList.remove('sidenav-open');
			menuButton.classList.remove('close');
			menuToggleContainer.classList.remove('open');
			buttonContainer.style.display = 'flex';
			tabContent.style.display = 'none';
			searchContainer.classList.remove('search-visible');

			setTimeout(() => {
				map.resize();
			}, 300);
		});
	});

	if (!document.querySelector('.style-circle.active')) {
		styleCircles.forEach(circle => {
			if (circle.dataset.style === activeMapStyle) {
				circle.classList.add('active');
			}
		});
	}
}

function scrollToList() {
	const listingElement = document.getElementById('route-attractions-listing');
	if (listingElement) {
		listingElement.scrollIntoView({
			behavior: 'smooth',
			block: 'start'
		});
	}
}

function calculateRoute(start, end) {
    const straightLineDistance = turf.distance(
        turf.point([start[0], start[1]]),
        turf.point([end[0], end[1]]), {
            units: 'kilometers'
        }
    );

    if (straightLineDistance > 2000) {
        removeRoute();
        clearRouteResults();
        document.getElementById('route-info').innerHTML = `
            <div class="route-error">
                You have specified a route that exceeds our maximum of 2000 km (1243 mi). Please check your locations!
            </div>
        `;
        return;
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?steps=true&geometries=geojson&access_token=${mapboxgl.accessToken}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (!data.routes || !data.routes[0]) {
                throw new Error('No route found');
            }

            const route = data.routes[0];
            const distanceInKm = route.distance / 1000;

            if (distanceInKm > 2000) {
                removeRoute();
                clearRouteResults();
                document.getElementById('route-info').innerHTML = `
                    <div class="route-error">
                        You have specified a route that exceeds our maximum of 2000 km (1243 mi). Please check your locations!
                    </div>
                `;
                return;
            }

            const coordinates = route.geometry.coordinates;
            addRoute(coordinates);

            const durationMinutes = Math.round(route.duration / 60);
            const hours = Math.floor(durationMinutes / 60);
            const minutes = durationMinutes % 60;
            const timeString = hours > 0 ? `${durationMinutes}min (${hours}h${minutes}min)` : `${durationMinutes}min`;
            const distanceInMiles = distanceInKm * 0.621371;

            document.getElementById('route-info').innerHTML = `
            <div class="route-details">
                <p>
                    <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px; min-width: 16px;">
                        <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-5h14v5z" fill="white"/>
                        <circle cx="7.5" cy="14.5" r="1.5" fill="white"/>
                        <circle cx="16.5" cy="14.5" r="1.5" fill="white"/>
                    </svg>
                    <span>${distanceInKm.toFixed(1)}km (${distanceInMiles.toFixed(1)}mi)</span>
                </p>
                <p>
                    <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px; min-width: 16px;">
                        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="white"/>
                        <path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="white"/>
                    </svg>
                    <span>${timeString}</span>
                </p>
                <p onclick="scrollToList()" style="cursor: pointer;">
                    <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px; min-width: 16px;">
                        <path d="M7.41 8.59L12 13.17l4.59-4.58c.39-.39 1.02-.39 1.41 0 .39.39.39 1.02 0 1.41L12.7 15.3a.9959.9959 0 0 1-1.41 0L6 10c-.39-.39-.39-1.02 0-1.41.39-.38 1.03-.39 1.41 0z M7.41 13.59L12 18.17l4.59-4.58c.39-.39 1.02-.39 1.41 0 .39.39.39 1.02 0 1.41L12.7 20.3a.9959.9959 0 0 1-1.41 0L6 15c-.39-.39-.39-1.02 0-1.41.39-.38 1.03-.39 1.41 0z" fill="white"/>
                    </svg>
                    <span>Show List</span>
                </p>
            </div>`;

            const currentRadius = parseInt(document.getElementById('route-radius').value || 50);
            updateRouteAttractions(coordinates);

            // LÄGG TILL DENNA NYA KOD HÄR
            const shareButton = document.getElementById('share-route');
            if (shareButton) {
                shareButton.style.display = 'flex';
                shareButton.onclick = handleRouteShare;
            }
            // SLUT PÅ NY KOD

        })
        .catch(error => {
            console.error('Error calculating route:', error);
            removeRoute();
            clearRouteResults();
            document.getElementById('route-info').innerHTML = `
                <div class="route-error">
                    An error occurred while calculating the route. Please try again.
                </div>
            `;
        });
}


function clearRouteResults() {
	const routeListing = document.getElementById('route-attractions-listing');
	if (routeListing) {
		routeListing.innerHTML = '';
	}

	removeRoute();

	if (map.getSource('route-buffer')) {
		map.getSource('route-buffer').setData({
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: []
			}
		});
	}


	const routeInfo = document.getElementById('route-info');
	if (routeInfo) {
		routeInfo.innerHTML = '';
	}
}

function removeRoute() {
	if (map.getSource('route')) {
		map.removeLayer('route');
		map.removeSource('route');
	}

	if (map.getSource('route-buffer')) {
		map.getSource('route-buffer').setData({
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: []
			}
		});
	}
}

function addRoute(coordinates) {
	removeRouteAndBuffer();

	map.addSource('route', {
		'type': 'geojson',
		'data': {
			'type': 'Feature',
			'properties': {},
			'geometry': {
				'type': 'LineString',
				'coordinates': coordinates
			}
		}
	});

	map.addLayer({
		'id': 'route',
		'type': 'line',
		'source': 'route',
		'layout': {
			'line-join': 'round',
			'line-cap': 'round'
		},
		'paint': {
			'line-color': '#003366',
			'line-width': 6,
			'line-opacity': 0.8
		}
	});

	const currentRadius = parseInt(document.getElementById('route-radius')?.value || 50);
	updateRouteBuffer(coordinates, currentRadius);

	const bounds = new mapboxgl.LngLatBounds();
	coordinates.forEach(coord => bounds.extend(coord));
	map.fitBounds(bounds, {
		padding: 50
	});
}

async function getCoordinates(place) {
	try {
		const forwardUrl = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(place)}&limit=1&access_token=${mapboxgl.accessToken}`;
		const response = await fetch(forwardUrl);
		const data = await response.json();

		if (!data.features || data.features.length === 0) {
			throw new Error('Location not found');
		}

		return data.features[0].geometry.coordinates;
	} catch (error) {
		console.error('Error in getCoordinates:', error);
		throw new Error('Failed to get coordinates');
	}
}

async function getRoute(start, end) {
	const response = await fetch(
		`https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&access_token=${mapboxgl.accessToken}`
	);
	const data = await response.json();

	if (!data.routes.length) {
		throw new Error('No route found');
	}

	return data.routes[0];
}




function getSuggestions(query, suggestionsDiv, inputElement, isStart) {
	if (!query) {
		suggestionsDiv.style.display = 'none';
		return;
	}

	const url = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(query)}&language=en&limit=10&types=place,address,poi,locality,neighborhood&access_token=${mapboxgl.accessToken}`;

	fetch(url)
		.then(response => response.json())
		.then(data => {
			suggestionsDiv.innerHTML = '';

			if (!data.features || data.features.length === 0) {
				suggestionsDiv.style.display = 'none';
				return;
			}

			data.features.forEach(feature => {
				const div = document.createElement('div');
				div.className = 'suggestion-item';

				div.innerHTML = `
                    <div class="suggestion-details">
                        <span class="place-name">${feature.properties.name}</span>
                        <span class="place-type">${feature.properties.full_address || feature.properties.place_formatted}</span>
                    </div>
                `;

				let touchStartY;

				div.addEventListener('touchstart', (e) => {
					touchStartY = e.touches[0].clientY;
				});

				div.addEventListener('touchend', (e) => {
					const touchEndY = e.changedTouches[0].clientY;
					const verticalMove = Math.abs(touchEndY - touchStartY);

					if (verticalMove < 10) {
						e.preventDefault();
						handleSelection();
					}
				});


				div.addEventListener('click', (e) => {
					e.preventDefault();
					handleSelection();
				});

				function handleSelection() {
					const coords = feature.geometry.coordinates;

					const nameParts = [];
					if (feature.properties.name) nameParts.push(feature.properties.name);
					if (feature.properties.place_formatted) {
						const additionalParts = feature.properties.place_formatted.split(',')
							.map(part => part.trim())
							.filter(part => part && part !== feature.properties.name);
						nameParts.push(...additionalParts);
					}

					const fullName = nameParts.join(', ');
					inputElement.value = fullName;
					suggestionsDiv.style.display = 'none';

					if (isStart) {
						startCoords = coords;
						const destinationInput = document.getElementById('end-point');
						if (destinationInput) {
							destinationInput.focus();
						}
					} else {
						endCoords = coords;
						inputElement.blur();


						if (startCoords && endCoords) {
							const calculateBtn = document.getElementById('calculate-route');
							if (calculateBtn) calculateBtn.focus();
						}
					}
				}

				suggestionsDiv.appendChild(div);
			});

			suggestionsDiv.style.display = 'block';
		})
		.catch(error => {
			console.error('Error fetching suggestions:', error);
			suggestionsDiv.style.display = 'none';
		});
}

function displaySearchResults(features) {
	searchResults.innerHTML = '';

	if (features.length === 0) {
		searchResults.style.display = 'none';
		return;
	}

	const fragment = document.createDocumentFragment();

	features.forEach((feature) => {
		const resultItem = document.createElement('div');
		resultItem.className = 'search-result-item';

		const isCustomFeature = feature.properties && !feature.properties.mapbox_id;
		const coordinates = feature.geometry.coordinates;
		const name = isCustomFeature ? feature.properties.Name : feature.properties.Name;
		const description = feature.properties.Description || '';

		let displayText = name;
		if (description && !isCustomFeature) {
			displayText = `${name}, ${description}`;
		}

		const markerElement = !isCustomFeature ? new mapboxgl.Marker({
			color: '#00b4ff',
			scale: 0.6
		}).getElement().outerHTML : '⭐';

		resultItem.innerHTML = `
            <div class="search-result-content">
                <div class="search-result-icon" style="position: relative;">
                    ${markerElement}
                </div>
                <div class="search-result-title">${displayText}</div>
            </div>
        `;

		let touchStartY;

		resultItem.addEventListener('touchstart', (e) => {
			touchStartY = e.touches[0].clientY;
		});

		resultItem.addEventListener('touchend', (e) => {
			const touchEndY = e.changedTouches[0].clientY;
			const verticalMove = Math.abs(touchEndY - touchStartY);

			if (verticalMove < 10) {
				e.preventDefault();
				handleSelection();
			}
		});

		resultItem.addEventListener('click', (e) => {
			e.preventDefault();
			handleSelection();
		});

		function handleSelection() {
			const mySidenav = document.getElementById('mySidenav');
			const mapElement = document.getElementById('map');
			const buttonContainer = document.getElementById('button-container');
			const tabContent = document.getElementById('tab-content');
			const body = document.body;

			mySidenav.classList.remove('open');
			body.classList.remove('sidenav-open');
			mapElement.style.width = '100%';
			mapElement.style.height = '100%';
			buttonContainer.style.display = 'flex';
			tabContent.style.display = 'none';
			searchContainer.classList.remove('search-visible');
			document.querySelector('.menu-toggle').classList.remove('close');

			searchResults.style.display = 'none';
			searchInput.value = '';
			searchClear.style.display = 'none';

			if (currentPopup) {
				currentPopup.remove();
				currentPopup = null;
			}


			const isAndroidChrome = /Android/.test(navigator.userAgent) && /Chrome/.test(navigator.userAgent);

			if (isAndroidChrome) {

				map.setCenter(coordinates);
				map.setZoom(11);


				setTimeout(() => {
					const isCoordinate = name?.startsWith('Coordinates:');
					if (isCustomFeature && !isCoordinate) {
						searchMarker.remove();
						currentPopup = new mapboxgl.Popup({
								closeButton: true,
								closeOnClick: true
							})
							.setLngLat(coordinates)
							.setHTML(getPopupContent({
								properties: {
									Name: name,
									Description: description
								}
							}, coordinates))
							.addTo(map);
							// LÄGG TILL DETTA DIREKT EFTER:
const popupEl = currentPopup.getElement();
if (popupEl) {
    // Navigate
    const navBtn = popupEl.querySelector('.popup-action-btn.navigate');
    if (navBtn) {
        navBtn.addEventListener('click', function() {
            const coords = navBtn.getAttribute('data-coords').split(',').map(Number);
            navigateToLocation(coords);
        });
    }

    // Save
    const saveBtn = popupEl.querySelector('.popup-action-btn.save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            const name = decodeURIComponent(saveBtn.getAttribute('data-name'));
            updateSaveState(name);
        });
    }

    // Images
    const imagesBtn = popupEl.querySelector('.popup-action-btn.images');
    if (imagesBtn) {
        imagesBtn.addEventListener('click', function() {
            const name = decodeURIComponent(imagesBtn.getAttribute('data-name'));
            searchGoogleImages(name);
        });
    }

    // Search
    const searchBtn = popupEl.querySelector('.popup-action-btn.search');
    if (searchBtn) {
        searchBtn.addEventListener('click', function() {
            const name = decodeURIComponent(searchBtn.getAttribute('data-name'));
            searchGoogle(name);
        });
    }
}
					} else {
						searchMarker.setLngLat(coordinates).addTo(map);
					}
				}, 50);
			} else {

				map.flyTo({
					center: coordinates,
					zoom: 11,
					essential: true
				});

				const isCoordinate = name?.startsWith('Coordinates:');
				if (isCustomFeature && !isCoordinate) {
					searchMarker.remove();
					currentPopup = new mapboxgl.Popup({
							closeButton: true,
							closeOnClick: true
						})
						.setLngLat(coordinates)
						.setHTML(getPopupContent({
							properties: {
								Name: name,
								Description: description
							}
						}, coordinates))
						.addTo(map);
				} else {
					searchMarker.setLngLat(coordinates).addTo(map);
				}
			}

			setTimeout(() => {
				map.resize();
			}, 300);
		}

		fragment.appendChild(resultItem);
	});

	searchResults.appendChild(fragment);
	searchResults.style.display = 'block';
}

document.addEventListener('click', (e) => {
	if (!searchResults.contains(e.target) && !searchInput.contains(e.target)) {
		searchResults.style.display = 'none';
		searchInput.value = '';
		searchClear.style.display = 'none';
	}
});

searchResults.addEventListener('click', (e) => {
	e.stopPropagation();
});

searchInput.addEventListener('click', (e) => {
	e.stopPropagation();
});

window.addEventListener('resize', () => {
	const mySidenav = document.getElementById('mySidenav');
	const mapElement = document.getElementById('map');

	if (mySidenav.classList.contains('open')) {
		mapElement.style.width = window.innerWidth <= 768 ? '50%' : '80%';
	} else {
		mapElement.style.width = '100%';
		mapElement.style.height = '100%';
	}

	map.resize();
});


function selectTab(tabId) {
	const buttonContainer = document.getElementById('button-container');
	const tabContent = document.getElementById('tab-content');
	const bottomMenu = document.getElementById('bottom-menu');
	const mapElement = document.getElementById('map');
	const mySidenav = document.getElementById('mySidenav');
	const body = document.body;
	const sidenavContent = document.querySelector('.sidenav-content');

	if (tabId && tabId !== 'tab4') {
		sidenavContent.classList.add('tab-active');
		buttonContainer.style.display = 'none';
	} else {
		sidenavContent.classList.remove('tab-active');
		buttonContainer.style.display = 'flex';
	}

	tabContent.innerHTML = '';
	tabContent.style.display = 'none';
	bottomMenu.style.display = 'none';

	switch (tabId) {
		case 'tab1':
			tabContent.innerHTML = `
                <div class="category-panel">
                    <div class="style-circle-container">
                        <div class="style-circle-wrapper">
                            <div class="style-circle ${activeMapStyle === 'mapbox://styles/mapbox/outdoors-v12' ? 'active' : ''}" 
                                 data-style="mapbox://styles/mapbox/outdoors-v12" 
                                 data-projection="globe">
                                <img src="img/outdoor.jpg" alt="" title="Outdoor Globe">
                            </div>
                        </div>
                        <div class="style-circle-wrapper">
                            <div class="style-circle ${activeMapStyle === 'mapbox://styles/mapbox/satellite-streets-v12' ? 'active' : ''}" 
                                 data-style="mapbox://styles/mapbox/satellite-streets-v12" 
                                 data-projection="globe">
                                <img src="img/satellite.jpg" alt="" title="Satellite">
                            </div>
                        </div>
                        <div class="style-circle-wrapper">
                            <div class="style-circle ${activeMapStyle === 'mapbox://styles/mapbox/dark-v11' ? 'active' : ''}" 
                                 data-style="mapbox://styles/mapbox/dark-v11" 
                                 data-projection="globe">
                                <img src="img/dark.jpg" alt="" title="Dark">
                            </div>
                        </div>
                        <div class="style-circle-wrapper">
                            <div class="style-circle ${activeMapStyle === 'mapbox://styles/mapbox/streets-v12' ? 'active' : ''}" 
                                 data-style="mapbox://styles/mapbox/streets-v12" 
                                 data-projection="mercator">
                                <img src="img/street.jpg" alt="" title="Outdoor Mercator">
                            </div>
                        </div>
                    </div>
                    <div class="compact-filter-group">
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="green_markers" checked>
                            <span class="label-text">Highly recommend (1)</span>
                            <span class="color-dot" style="background: #4CAF50; border: 1px solid #ffffff;"></span>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="yellow_markers" checked>
                            <span class="label-text">Recommend (2)</span>
                            <span class="color-dot" style="background: #FFC107; border: 1px solid #ffffff;"></span>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="red_markers" checked>
                            <span class="label-text">Planned to be seen (4)</span>
                            <span class="color-dot" style="background: #f44336; border: 1px solid #ffffff;"></span>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="darkred_markers" checked>
                            <span class="label-text">Unseen, promising (5)</span>
                            <span class="color-dot" style="background: #b71c1c; border: 1px solid #ffffff;"></span>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="grey_markers" checked>
                            <span class="label-text">Unseen, low prio (6)</span>
                            <span class="color-dot" style="background: #9E9E9E; border: 1px solid #ffffff;"></span>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="white_markers" checked>
                            <span class="label-text">Other (7)</span>
                            <span class="color-dot" style="background: #FFFFFF; border: 1px solid #9E9E9E;"></span>
                        </label>
                    </div>
                    <div class="compact-filter-group">
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="accommodation_markers" checked>
                            <span class="label-text">Lodging (9)</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" class="icon">
                                <circle cx="12" cy="12" r="12" fill="#003366"/>
                                <path transform="translate(4.5,4.5)" fill="white" d="M0.5,2.5C0.2,2.5,0,2.7,0,3v7.5v2C0,12.8,0.2,13,0.5,13S1,12.8,1,12.5V11h13v1.5c0,0.3,0.2,0.5,0.5,0.5s0.5-0.2,0.5-0.5v-2c0-0.3-0.2-0.5-0.5-0.5H1V3C1,2.7,0.8,2.5,0.5,2.5z M3.5,3C2.7,3,2,3.7,2,4.5C2,5.3,2.7,6,3.5,6C4.3,6,5,5.3,5,4.5C5,3.7,4.3,3,3.5,3z M7,4C5.5,4,5.5,5.5,5.5,5.5V7h-3C2.2,7,2,7.2,2,7.5v1C2,8.8,2.2,9,2.5,9H6h9V6.5C15,4,12.5,4,12.5,4H7z"/>
                            </svg>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="nightlife_markers" checked>
                            <span class="label-text">Nightlife (10)</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" class="icon">
                                <circle cx="12" cy="12" r="12" fill="#003366"/>
                                <path transform="translate(4.5,4.5)" fill="white" d="M14,4h-4v3.44c0.003,0.9096,0.6193,1.7026,1.5,1.93V13H11c-0.2761,0-0.5,0.2239-0.5,0.5S10.7239,14,11,14h2c0.2761,0,0.5-0.2239,0.5-0.5S13.2761,13,13,13h-0.5V9.43c0.8807-0.2274,1.497-1.0204,1.5-1.93V4z M13,7.5c0,0.5523-0.4477,1-1,1s-1-0.4477-1-1V5h2V7.5z M5.5,2.5V2C5.7761,2,6,1.7761,6,1.5S5.7761,1,5.5,1V0.5C5.5,0.2239,5.2761,0,5,0H4C3.7239,0,3.5,0.2239,3.5,0.5V1C3.2239,1,3,1.2239,3,1.5S3.2239,2,3.5,2v0.5C3.5,3.93,1,5.57,1,7v6c0,0.5523,0.4477,1,1,1h5c0.5318-0.0465,0.9535-0.4682,1-1V7C8,5.65,5.5,3.85,5.5,2.5z M4.5,12C3.1193,12,2,10.8807,2,9.5S3.1193,7,4.5,7S7,8.1193,7,9.5S5.8807,12,4.5,12z"/>
                            </svg>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="restaurant_markers" checked>
                            <span class="label-text">Dining (11)</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" class="icon">
                                <circle cx="12" cy="12" r="12" fill="#003366"/>
                                <path transform="translate(4.5,4.5)" fill="white" d="M3.5,0l-1,5.5c-0.1464,0.805,1.7815,1.181,1.75,2L4,14c-0.0384,0.9993,1,1,1,1s1.0384-0.0007,1-1L5.75,7.5c-0.0314-0.8176,1.7334-1.1808,1.75-2L6.5,0H6l0.25,4L5.5,4.5L5.25,0h-0.5L4.5,4.5L3.75,4L4,0H3.5z M12,0c-0.7364,0-1.9642,0.6549-2.4551,1.6367C9.1358,2.3731,9,4.0182,9,5v2.5c0,0.8182,1.0909,1,1.5,1L10,14c-0.0905,0.9959,1,1,1,1s1,0,1-1V0z"/>
                            </svg>
                        </label>
                    </div>
                    <div class="compact-filter-group">
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="line_yellow_markers" checked>
                            <span class="label-text">Traveled (12)</span>
                            <span class="line-dot" style="background: #FFC107;"></span>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="line_red_markers" checked>
                            <span class="label-text">Planned to go (13)</span>
                            <span class="line-dot" style="background: #f44336;"></span>
                        </label>
                        <label class="compact-checkbox">
                            <input type="checkbox" data-layer="line_grey_markers" checked>
                            <span class="label-text">Unseen, low prio (14)</span>
                            <span class="line-dot" style="background: #9E9E9E;"></span>
                        </label>
                    </div>
                </div>`;
			tabContent.className = 'tab1';
			tabContent.style.display = 'block';
			const checkboxes = tabContent.querySelectorAll('.compact-checkbox input[type="checkbox"]');
			checkboxes.forEach(checkbox => {
				const layerId = checkbox.dataset.layer;
				checkbox.checked = layerVisibility[layerId] !== 'none';
			});

			initializeFilters();
			initializeStyleSelector();
			break;

		case 'tab3':
			tabContent.innerHTML = `
                <div class="category-panel">
                    <h2>Saved Attractions:</h2>
                    <div class="saved-attractions-container">
                        <span id="cart"></span>
                        <div class="export-buttons">
                            <button class="popup-action-btn" onclick="ClearShop()">
                                <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px;" class="delete-icon">
                                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="#FF5722"/>
                                </svg>
                                Clear All
                            </button>
                        </div>
                    </div>
                    <div class="export-section">
                        <div class="export-buttons">
                            <button class="popup-action-btn" onclick="JSONToKMLConvertor()">
                                <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px;">
                                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.01l1.41 1.41L11 14.84V19h2v-4.16l1.59 1.59L16 15.01 12.01 11z" fill="white"/>
                                </svg>
                                Export .KML
                                <span class="export-description">(Google Earth/Maps)</span>
                            </button>
                            <button class="popup-action-btn" onclick="JSONToCSVConvertor()">
                                <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 4px;">
                                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 16h8v2H8zm0-4h8v2H8zm0-4h3v2H8z" fill="white"/>
                                </svg>
                                Export .CSV
                                <span class="export-description">(Sheets/Excel)</span>
                            </button>
                        </div>
                    </div>
                </div>`;
			displayCart();
			tabContent.className = 'tab3';
			tabContent.style.display = 'block';
			break;

case 'tab4':
    tabContent.innerHTML = /* html */ `
        <div class="category-panel">
            <h2>Help</h2>
            <div class="help-text">
                <p style="padding: 14px; color: #d222d2;">
                    <b>Welcome! This is the private map for Resekartan. You are welcome to use it. However, the official version, which is better adapted, can be found <a href="https://resekartan.se/map.html">here</a>.</b>
                </p>
            </div>
        </div>`;
    tabContent.className = 'tab4';
    tabContent.style.display = 'block';
    buttonContainer.style.display = 'none';
    break;

		case 'tab2':
			mySidenav.classList.remove('open');
			body.classList.remove('sidenav-open');
			mapElement.classList.add('list-view');
			mapElement.style.height = '60%';
			bottomMenu.style.display = 'flex';
			bottomMenu.innerHTML = `
                <div class="map-overlay">
                    <fieldset>
                        <input id="feature-filter" type="text" placeholder="Filter results by name">
                    </fieldset>
                    <div id="feature-listing" class="listing"></div>
                </div>`;
			initializeListingFunctionality();
			setTimeout(() => {
				map.resize();
			}, 300);
			break;

		case 'tab5':
			startCoords = null;
			endCoords = null;

			mySidenav.classList.remove('open');
			body.classList.remove('sidenav-open');
			mapElement.classList.add('list-view');
			mapElement.style.height = '60%';
			bottomMenu.style.display = 'flex';
			bottomMenu.innerHTML = `
        <div class="map-overlay">
            <div class="tab5-scroll-container">
                <fieldset style="display: block;">
                    <div class="route-description">
                        Discover attractions along your route by using a detour search with Points of Interests.
                    </div>
                    <div class="explore-route-container">
                        <div class="input-wrapper">
                            <input type="text" id="start-point" placeholder="Starting point" autocomplete="off">
                            <div class="suggestions" id="start-suggestions"></div>
                        </div>
                        <div class="input-wrapper">
                            <input type="text" id="end-point" placeholder="Destination" autocomplete="off">
                            <div class="suggestions" id="end-suggestions"></div>
                        </div>
<div class="button-group">
    <button id="calculate-route" class="popup-action-btn">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" fill="#FFFFFF"/></svg>
        Find
    </button>
    <button id="share-route" class="popup-action-btn" style="display: none;">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92zM18 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM6 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm12 7.02c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" fill="#FFFFFF"/></svg>
        Share
    </button>
</div>
                    </div>
                    <div class="inputs-width-container">
                        <span class="radius-label">Radius:</span>
                        <input type="range" id="route-radius" min="2" max="100" value="10" class="route-radius-slider">
                        <div class="route-radius-value">
                            <span id="radius-display">10</span>km (<span id="radius-display-miles">6</span>mi)
                        </div>
                    </div>
                </fieldset>
                <div id="route-info" class="route-info"></div>
                <div id="route-attractions-listing" class="listing"></div>
            </div>
        </div>
    `;

			const routeRadiusSlider = document.getElementById('route-radius');
			const radiusDisplay = document.getElementById('radius-display');
			const radiusDisplayMiles = document.getElementById('radius-display-miles');
			const startInput = document.getElementById('start-point');
			const endInput = document.getElementById('end-point');
			const startSuggestions = document.getElementById('start-suggestions');
			const endSuggestions = document.getElementById('end-suggestions');
			const calculateBtn = document.getElementById('calculate-route');
			const routeInfo = document.getElementById('route-info');

			if (startInput) startInput.value = '';
			if (endInput) endInput.value = '';
			if (routeInfo) routeInfo.innerHTML = '';

			let lastRadiusKm = parseInt(routeRadiusSlider.value);
			let isDragging = false;

			routeRadiusSlider.addEventListener('input', function(e) {
				const radiusKm = parseInt(e.target.value);
				const radiusMiles = Math.round(radiusKm * 0.621371);

				radiusDisplay.textContent = radiusKm;
				radiusDisplayMiles.textContent = radiusMiles;

				lastRadiusKm = radiusKm;

				document.body.style.overflow = 'hidden';
			});

			routeRadiusSlider.addEventListener('touchend', updateBufferAndAttractions);
			routeRadiusSlider.addEventListener('mouseup', updateBufferAndAttractions);
			routeRadiusSlider.addEventListener('touchcancel', resetSlider);

			function updateBufferAndAttractions() {
				if (map.getSource('route')) {
					const routeData = map.getSource('route')._data;
					if (routeData && routeData.geometry) {
						updateRouteBuffer(routeData.geometry.coordinates, lastRadiusKm);
						updateRouteAttractions(routeData.geometry.coordinates);
					}
				}
				resetSlider();
			}

			function resetSlider() {
				isDragging = false;
				document.body.style.overflow = 'auto';
			}

			routeRadiusSlider.addEventListener('touchstart', function(e) {
				isDragging = true;
				document.body.style.overflow = 'hidden';
			});

			routeRadiusSlider.addEventListener('touchmove', function(e) {
				if (!isDragging) return;

				const rect = routeRadiusSlider.getBoundingClientRect();
				const touchX = e.touches[0].clientX;
				let newValue = Math.round(((touchX - rect.left) / rect.width) * (routeRadiusSlider.max - routeRadiusSlider.min) + parseInt(routeRadiusSlider.min));

				newValue = Math.max(routeRadiusSlider.min, Math.min(routeRadiusSlider.max, newValue));

				routeRadiusSlider.value = newValue;

				const radiusMiles = Math.round(newValue * 0.621371);

				radiusDisplay.textContent = newValue;
				radiusDisplayMiles.textContent = radiusMiles;

				lastRadiusKm = newValue;
			});

			let startDebounceTimer;
			let endDebounceTimer;

			startInput.addEventListener('input', (e) => {
				startCoords = null;
				clearTimeout(startDebounceTimer);
				startDebounceTimer = setTimeout(() => {
					getSuggestions(e.target.value, startSuggestions, startInput, true);
				}, 300);
			});

			endInput.addEventListener('input', (e) => {
				endCoords = null;
				clearTimeout(endDebounceTimer);
				endDebounceTimer = setTimeout(() => {
					getSuggestions(e.target.value, endSuggestions, endInput, false);
				}, 300);
			});

			document.addEventListener('click', (e) => {
				if (!e.target.closest('.input-wrapper')) {
					startSuggestions.style.display = 'none';
					endSuggestions.style.display = 'none';
				}
			});

			calculateBtn.addEventListener('click', () => {
				if (!startCoords || !endCoords) {
					routeInfo.innerHTML = `
                <div class="route-error">
                    Please select both start and destination points from the suggestions.
                </div>
            `;
					return;
				}
				calculateRoute(startCoords, endCoords);
			});

			setTimeout(() => {
				map.resize();
			}, 300);
			break;
	}
}


function createShareableRouteLink() {
    if (!startCoords || !endCoords) return null;
    
    const params = new URLSearchParams();
    // Spara de faktiska platsnamnen istället för koordinater
    params.append('startName', document.getElementById('start-point').value);
    params.append('endName', document.getElementById('end-point').value);
    params.append('radius', document.getElementById('route-radius').value);
    params.append('tab', 'route');
    
    const baseUrl = window.location.href.split('?')[0];
    return `${baseUrl}?${params.toString()}`;
}

function handleRouteShare() {
    const shareLink = createShareableRouteLink();
    if (!shareLink) return;

    navigator.clipboard.writeText(shareLink).then(() => {
        createNotification('Share link copied to clipboard.');
    }).catch(err => {
        console.error('Failed to copy link:', err);
        createNotification('Failed to copy share link.');
    });
}

function loadSharedRoute() {
    const params = new URLSearchParams(window.location.search);
    const startName = params.get('startName');
    const endName = params.get('endName');
    const radiusParam = params.get('radius');
    const tabParam = params.get('tab');

    if (tabParam === 'route' && startName && endName) {
        // Förhindra rotation genom att sätta urlParams
        window.urlParams = true;
        
        selectTab('tab5');
        
        setTimeout(() => {
            const startInput = document.getElementById('start-point');
            const endInput = document.getElementById('end-point');
            const radiusSlider = document.getElementById('route-radius');
            const calculateButton = document.getElementById('calculate-route');
            
            // Sätt platsnamnen direkt
            startInput.value = startName;
            endInput.value = endName;
            
            // Använd platsnamnen för att få koordinater
            Promise.all([
                fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(startName)}.json?access_token=${mapboxgl.accessToken}`),
                fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(endName)}.json?access_token=${mapboxgl.accessToken}`)
            ])
            .then(responses => Promise.all(responses.map(r => r.json())))
            .then(([startData, endData]) => {
                if (startData.features && startData.features[0]) {
                    startCoords = startData.features[0].center;
                }
                if (endData.features && endData.features[0]) {
                    endCoords = endData.features[0].center;
                }
                
                if (radiusParam) {
                    radiusSlider.value = radiusParam;
                    const radiusEvent = new Event('input');
                    radiusSlider.dispatchEvent(radiusEvent);
                }
                
                if (startCoords && endCoords) {
                    calculateButton.click();
                }
            });
        }, 500);
    }
}

function updateRouteBuffer(coordinates, radiusKm) {
	if (!coordinates || !map.getSource('route-buffer')) return;

	try {
		const routeLine = turf.lineString(coordinates);
		const steps = Math.min(100, Math.max(30, Math.floor(radiusKm / 2)));
		const buffered = turf.buffer(routeLine, radiusKm, {
			units: 'kilometers',
			steps: steps
		});
		map.getSource('route-buffer').setData(buffered);
	} catch (error) {
		console.error('Error updating route buffer:', error);
	}
}

function removeRouteAndBuffer() {
	if (map.getLayer('route')) {
		map.removeLayer('route');
	}
	if (map.getSource('route')) {
		map.removeSource('route');
	}
	if (map.getSource('route-buffer')) {
		map.getSource('route-buffer').setData({
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: []
			}
		});
	}
}

function navigateToLocation(coords) {
	const lat = coords[1];
	const lng = coords[0];

	const isAppleDevice = /iPhone|iPad|iPod|Mac/i.test(navigator.userAgent);

	const navigationUrls = {
		googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
		appleMaps: isAppleDevice ?
			`http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
		waze: `https://www.waze.com/live-map/directions?to=ll.${lat}%2C${lng}`
	};

	const toggleBodyScroll = (disable) => {
		document.body.style.overflow = disable ? 'hidden' : '';
		document.body.style.position = disable ? 'fixed' : '';
		document.body.style.width = disable ? '100%' : '';
	};

	const mapChoice = document.createElement('div');
	mapChoice.className = 'map-choice-dialog';
	mapChoice.innerHTML = `
        <div class="map-choice-content">
            <h3>Choose Navigation App</h3>
            <button onclick="window.open('${navigationUrls.googleMaps}', '_blank')" class="google-maps-btn">
                <svg class="nav-icon google-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 232597 333333">
                    <path d="M151444 5419C140355 1916 128560 0 116311 0 80573 0 48591 16155 27269 41534l54942 46222 69232-82338z" fill="#1a73e8"/>
                    <path d="M27244 41534C10257 61747 0 87832 0 116286c0 21876 4360 39594 11517 55472l70669-84002-54942-46222z" fill="#ea4335"/>
                    <path d="M116311 71828c24573 0 44483 19910 44483 44483 0 10938-3957 20969-10509 28706 0 0 35133-41786 69232-82313-14089-27093-38510-47936-68048-57286L82186 87756c8166-9753 20415-15928 34125-15928z" fill="#4285f4"/>
                    <path d="M116311 160769c-24573 0-44483-19910-44483-44483 0-10863 3906-20818 10358-28555l-70669 84027c12072 26791 32159 48289 52851 75381l85891-102122c-8141 9628-20339 15752-33948 15752z" fill="#fbbc04"/>
                    <path d="M148571 275014c38787-60663 84026-88210 84026-158728 0-19331-4738-37552-13080-53581L64393 247140c6578 8620 13206 17793 19683 27900 23590 36444 17037 58294 32260 58294 15172 0 8644-21876 32235-58320z" fill="#34a853"/>
                </svg>
                Google Maps
            </button>
            <button onclick="window.open('${navigationUrls.appleMaps}', '_blank')" class="apple-maps-btn">
                <svg class="nav-icon apple-icon" viewBox="0 0 814 1000">
                    <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" fill="#cccccc"/>
                </svg>
                Apple Maps
            </button>
            <button onclick="window.open('${navigationUrls.waze}', '_blank')" class="waze-btn">
                <svg class="nav-icon waze-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path d="M13.314 1.59c-.225.003-.45.013-.675.03-2.165.155-4.295.924-6.069 2.327-2.194 1.732-3.296 4.325-3.496 7.05h.002c-.093 1.22-.23 2.15-.469 2.63-.238.479-.42.638-1.24.639C.27 14.259-.4 15.612.266 16.482c1.248 1.657 2.902 2.705 4.72 3.364a2.198 2.198 0 00-.033.367 2.198 2.198 0 002.2 2.197 2.198 2.198 0 002.128-1.668c1.307.12 2.607.14 3.824.1.364-.012.73-.045 1.094-.092a2.198 2.198 0 002.127 1.66 2.198 2.198 0 002.2-2.197 2.198 2.198 0 00-.151-.797 12.155 12.155 0 002.303-1.549c2.094-1.807 3.511-4.399 3.302-7.404-.112-1.723-.761-3.298-1.748-4.608-2.143-2.86-5.53-4.309-8.918-4.265zm.366 1.54c.312.008.623.027.933.063 2.48.288 4.842 1.496 6.4 3.577v.001c.829 1.1 1.355 2.386 1.446 3.792v.003c.173 2.477-.965 4.583-2.777 6.147a10.66 10.66 0 01-2.375 1.535 2.198 2.198 0 00-.98-.234 2.198 2.198 0 00-1.934 1.158 9.894 9.894 0 01-1.338.146 27.323 27.323 0 01-3.971-.148 2.198 2.198 0 00-1.932-1.156 2.198 2.198 0 00-1.347.463c-1.626-.553-3.078-1.422-4.155-2.762 1.052-.096 1.916-.6 2.319-1.408.443-.889.53-1.947.625-3.198v-.002c.175-2.391 1.11-4.536 2.92-5.964h.002c1.77-1.402 3.978-2.061 6.164-2.012zm-3.157 4.638c-.688 0-1.252.579-1.252 1.298 0 .72.564 1.297 1.252 1.297.689 0 1.252-.577 1.252-1.297 0-.711-.563-1.298-1.252-1.298zm5.514 0c-.688 0-1.25.579-1.25 1.298-.008.72.554 1.297 1.25 1.297.688 0 1.252-.577 1.252-1.297 0-.711-.564-1.298-1.252-1.298zM9.641 11.78a.72.72 0 00-.588.32.692.692 0 00-.11.54c.345 1.783 2.175 3.129 4.264 3.129h.125c1.056-.032 2.026-.343 2.816-.922.767-.556 1.29-1.316 1.477-2.137a.746.746 0 00-.094-.547.69.69 0 00-.445-.32.714.714 0 00-.867.539c-.22.93-1.299 1.9-2.934 1.94-1.572.046-2.738-.986-2.926-1.956a.72.72 0 00-.718-.586Z" fill="#33ccff"/>
                </svg>
                Waze
            </button>
            <button class="cancel-btn" onclick="this.closest('.map-choice-dialog').remove(); toggleBodyScroll(false)">
                Cancel
            </button>
        </div>
    `;

	const existingDialog = document.querySelector('.map-choice-dialog');
	if (existingDialog) {
		existingDialog.remove();
	}

	document.body.appendChild(mapChoice);
	toggleBodyScroll(true);

	mapChoice.addEventListener('click', (e) => {
		if (e.target === mapChoice) {
			mapChoice.remove();
			toggleBodyScroll(false);
		}
	});


	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			const removedNodesArray = Array.from(mutation.removedNodes);
			if (removedNodesArray.includes(mapChoice)) {
				toggleBodyScroll(false);
				observer.disconnect();
			}
		});
	});

	observer.observe(document.body, {
		childList: true
	});
}

searchInput.addEventListener('input', (e) => {
	const query = e.target.value.trim();
	searchClear.style.display = query ? 'flex' : 'none';

	if (searchTimeout) {
		clearTimeout(searchTimeout);
	}

	if (!query) {
		searchResults.style.display = 'none';
		return;
	}

	const delay = fuseIndex ? 300 : 500;

	searchTimeout = setTimeout(() => {
		performSearch(query);
	}, delay);
});

searchClear.addEventListener('click', () => {
	searchInput.value = '';
	searchClear.style.display = 'none';
	searchResults.style.display = 'none';
});

async function initializeSearch() {
	try {
		const response = await fetch('generator.geojson');
		const data = await response.json();
		attractionsData = data;

		if (data && data.features) {
			searchIndex = data.features.reduce((acc, feature) => {
				if (feature.properties &&
					feature.properties.Name &&
					typeof feature.properties.Name === 'string') {
					const key = feature.properties.Name.toLowerCase();
					acc[key] = feature;
				}
				return acc;
			}, {});

			const fuseOptions = {
				keys: [
					'properties.Name',
					'properties.Description',
					'properties.Type'
				],
				threshold: 0.3,
				distance: 100
			};

			if (data.features.length > 0) {
				fuseIndex = new Fuse(data.features, fuseOptions);
				console.log('Search data and Fuzzy search initialized successfully');
			} else {
				console.log('No features found in data, fuseIndex not initialized');
			}
		}
	} catch (error) {
		console.error('Error loading search data:', error);
		fuseIndex = new Fuse([], {
			keys: ['properties.Name', 'properties.Description', 'properties.Type']
		});
	}
}



async function performSearch(query) {
	try {
		const coordMatch = query.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
		if (coordMatch) {
			const [, lat, lng] = coordMatch;
			const coordFeature = {
				type: 'Feature',
				geometry: {
					type: 'Point',
					coordinates: [parseFloat(lng), parseFloat(lat)]
				},
				properties: {
					Name: `Coordinates: ${lat}, ${lng}`,
					Description: `Location: ${lat}°N, ${lng}°E`
				},
				place_name: `Coordinates: ${lat}, ${lng}`,
				center: [parseFloat(lng), parseFloat(lat)]
			};
			displaySearchResults([coordFeature]);
			return;
		}

		let customFeatures = [];
		if (fuseIndex) {
			customFeatures = fuseIndex.search(query)
				.map(result => result.item)
				.filter(feature => feature.geometry.type === 'Point');
		}

		const mapboxLimit = customFeatures.length >= 5 ? 5 : (10 - customFeatures.length);

		let mapboxFeatures = [];
		if (mapboxLimit > 0) {
			const searchParams = new URLSearchParams({
				q: query,
				access_token: mapboxgl.accessToken,
				limit: mapboxLimit,
				fuzzyMatch: 'true',
				autocomplete: 'true',
				proximity: `${map.getCenter().lng},${map.getCenter().lat}`,
				types: [
					'country',
					'region',
					'postcode',
					'district',
					'place',
					'locality',
					'neighborhood',
					'street',
					'address'
				].join(',')
			});

			const geocodingUrl = `https://api.mapbox.com/search/geocode/v6/forward?${searchParams}`;
			const response = await fetch(geocodingUrl);
			const data = await response.json();

			if (data && data.features) {
				mapboxFeatures = data.features
					.filter(feature => feature.geometry.type === 'Point')
					.map(feature => ({
						type: 'Feature',
						geometry: feature.geometry,
						properties: {
							Name: feature.properties.name,
							Description: feature.properties.place_formatted,
							mapbox_id: feature.properties.mapbox_id,
							feature_type: feature.properties.feature_type,
							coordinates: feature.properties.coordinates,
							context: feature.properties.context,
							match_code: feature.properties.match_code
						},
						center: feature.geometry.coordinates
					}));
			}
		}


		const limitedCustomFeatures = customFeatures.slice(0, 5);
		const combinedResults = [...limitedCustomFeatures, ...mapboxFeatures].slice(0, 10);

		displaySearchResults(combinedResults);

	} catch (error) {
		console.error('Search error:', error);
	}
}

function getUrlParameters() {
    const queryString = window.location.search;
    if (!queryString) return null;

    const query = queryString.substring(1);
    
    // Support both formats: Y,X and X,Y
    const coordMatch = query.match(/([\d.]+),\s*([\d.]+)/);
    const zoomMatch = query.match(/zoomlevel=(\d+)/);

    if (coordMatch) {
        // Swap the coordinates if they're in Y,X format
        const firstCoord = parseFloat(coordMatch[1]);
        const secondCoord = parseFloat(coordMatch[2]);
        
        // Typically, latitude should be between -90 and 90
        // If the first coordinate is outside this range, assume it's longitude
        const isFirstCoordLng = Math.abs(firstCoord) > 90;
        
        return {
            lat: isFirstCoordLng ? secondCoord : firstCoord,
            lng: isFirstCoordLng ? firstCoord : secondCoord,
            zoom: zoomMatch ? parseInt(zoomMatch[1]) : 15
        };
    }
    return null;
}




function searchLocalFeatures(query) {
	query = query.toLowerCase();
	const results = [];
	const maxResults = 10;

	if (!searchIndex || !query) return results;

	for (const key in searchIndex) {
		const feature = searchIndex[key];
		if (feature.geometry.type === 'Point' && key.startsWith(query) && results.length < maxResults) {
			results.push({
				...feature,
				place_name: feature.properties.Name,
				place_type: ['custom'],
				center: feature.geometry.coordinates,
				exact_match: true
			});
		}
	}

	if (results.length < maxResults) {
		for (const key in searchIndex) {
			const feature = searchIndex[key];
			if (feature.geometry.type === 'Point' && !key.startsWith(query) && key.includes(query) && results.length < maxResults) {
				results.push({
					...feature,
					place_name: feature.properties.Name,
					place_type: ['custom'],
					center: feature.geometry.coordinates,
					exact_match: false
				});
			}
		}
	}

	if (results.length < maxResults && fuseIndex) {
		const fuzzyResults = fuseIndex.search(query)
			.filter(result => {
				return result.item.geometry.type === 'Point' &&
					!results.some(r => r.properties.Name === result.item.properties.Name);
			})
			.map(result => ({
				...result.item,
				place_name: result.item.properties.Name,
				place_type: ['custom'],
				center: result.item.geometry.coordinates,
				exact_match: false,
				fuzzy_match: true,
				score: result.score
			}));

		results.push(...fuzzyResults.slice(0, maxResults - results.length));
	}

	return results;
}

function displaySearchResults(features) {
	searchResults.innerHTML = '';

	if (features.length === 0) {
		searchResults.style.display = 'none';
		return;
	}

	const fragment = document.createDocumentFragment();

	features.forEach((feature) => {
		const resultItem = document.createElement('div');
		resultItem.className = 'search-result-item';

		const isCustomFeature = feature.properties && !feature.properties.mapbox_id;
		const coordinates = feature.geometry.coordinates;
		const name = isCustomFeature ? feature.properties.Name : feature.properties.Name;
		const description = feature.properties.Description || '';

		let displayText = name;
		if (description && !isCustomFeature) {
			displayText = `${name}, ${description}`;
		}

		const markerElement = !isCustomFeature ? new mapboxgl.Marker({
			color: '#00b4ff',
			scale: 0.6
		}).getElement().outerHTML : '⭐';

		resultItem.innerHTML = `
            <div class="search-result-content">
                <div class="search-result-icon" style="position: relative;">
                    ${markerElement}
                </div>
                <div class="search-result-title">${displayText}</div>
            </div>
        `;

		resultItem.addEventListener('click', () => {
			const mySidenav = document.getElementById('mySidenav');
			const mapElement = document.getElementById('map');
			const buttonContainer = document.getElementById('button-container');
			const tabContent = document.getElementById('tab-content');
			const body = document.body;

			mySidenav.classList.remove('open');
			body.classList.remove('sidenav-open');
			mapElement.style.width = '100%';
			mapElement.style.height = '100%';
			buttonContainer.style.display = 'flex';
			tabContent.style.display = 'none';
			searchContainer.classList.remove('search-visible');
			document.querySelector('.menu-toggle').classList.remove('close');

			searchResults.style.display = 'none';
			searchInput.value = '';
			searchClear.style.display = 'none';

			if (currentPopup) {
				currentPopup.remove();
				currentPopup = null;
			}

			map.flyTo({
				center: coordinates,
				zoom: 11,
				essential: true
			});

			const isCoordinate = name?.startsWith('Coordinates:');


			if (isCustomFeature && !isCoordinate) {
				searchMarker.remove();

				currentPopup = new mapboxgl.Popup({
						closeButton: true,
						closeOnClick: true
					})
					.setLngLat(coordinates)
					.setHTML(getPopupContent({
						properties: {
							Name: name,
							Description: description
						}
					}, coordinates))
					.addTo(map);
					    // LÄGG TILL DETTA DIREKT EFTER .addTo(map):
    const popupEl = currentPopup.getElement();
    if (popupEl) {
        // Navigate
        const navBtn = popupEl.querySelector('.popup-action-btn.navigate');
        if (navBtn) {
            navBtn.addEventListener('click', function() {
                const coords = navBtn.getAttribute('data-coords').split(',').map(Number);
                navigateToLocation(coords);
            });
        }

        // Save
        const saveBtn = popupEl.querySelector('.popup-action-btn.save');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                const name = decodeURIComponent(saveBtn.getAttribute('data-name'));
                updateSaveState(name);
            });
        }

        // Images
        const imagesBtn = popupEl.querySelector('.popup-action-btn.images');
        if (imagesBtn) {
            imagesBtn.addEventListener('click', function() {
                const name = decodeURIComponent(imagesBtn.getAttribute('data-name'));
                searchGoogleImages(name);
            });
        }

        // Search
        const searchBtn = popupEl.querySelector('.popup-action-btn.search');
        if (searchBtn) {
            searchBtn.addEventListener('click', function() {
                const name = decodeURIComponent(searchBtn.getAttribute('data-name'));
                searchGoogle(name);
            });
        }
    }
			} else {
				searchMarker.setLngLat(coordinates).addTo(map);
			}

			setTimeout(() => {
				map.resize();
			}, 300);
		});

		fragment.appendChild(resultItem);
	});

	searchResults.appendChild(fragment);
	searchResults.style.display = 'block';
}
