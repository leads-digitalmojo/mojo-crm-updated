import { LoginLog } from '../types';

export const getTrackingInfo = async () => {
    try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();
        return {
            ip: data.ip,
            city: data.city,
            region: data.region,
            country: data.country_name,
            loc: `${data.latitude}, ${data.longitude}`,
            org: data.org
        };
    } catch (error) {
        console.error('Error fetching tracking info:', error);
        return {
            ip: 'Unknown',
            city: 'Unknown',
            region: 'Unknown',
            country: 'Unknown',
            loc: 'Unknown',
            org: 'Unknown'
        };
    }
};

export const getLocationPermission = (): Promise<'granted' | 'denied' | 'prompt'> => {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve('denied');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            () => resolve('granted'),
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    resolve('denied');
                } else {
                    resolve('prompt');
                }
            },
            { timeout: 5000 }
        );
    });
};
